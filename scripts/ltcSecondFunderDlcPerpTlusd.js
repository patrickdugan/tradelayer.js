const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');

process.env.RPC_WALLET = process.env.RPC_WALLET || process.env.WALLET_NAME || 'tl-wallet';

const Encode = require('../src/txEncoder.js');
const Types = require('../src/types.js');
const Logic = require('../src/logic.js');
const TxUtils = require('../src/txUtils.js');
const TallyMap = require('../src/tally.js');
const Consensus = require('../src/consensus.js');
const ContractRegistry = require('../src/contractRegistry.js');
const MarginMap = require('../src/marginMap.js');
const Orderbook = require('../src/orderbook.js');
const VolumeIndex = require('../src/volumeIndex.js');
const Activation = require('../src/activation.js');
const { ProceduralRegistry, PROCEDURAL_STATES } = require('../src/procedural.js');

const COIN = 100000000;
const NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'tltc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0x3a,
  wif: 0xef
};

const FIRST_FUNDER = process.env.TL_FIRST_FUNDER || 'tltc1qkz0vft2fc4nk0u9fx4k9yk4th7zherna3zxh22';
const PROPERTY_ID = Number(process.env.TL_PROCEDURAL_PROPERTY || 380);
const TEMPLATE_ID = process.env.TL_DLC_TEMPLATE_ID || 'dlc-receipt-ltc-testnet-v1';
const DLC_HASH = process.env.TL_DLC_HASH || '60e19d0c4f34a09a690e679230bf41a63252306e0e06a09e1b090efbcbb7b499';
const PLEDGE_AMOUNT = Number(process.env.TL_PLEDGE_AMOUNT || 0.001);
const MARK_PRICE = Number(process.env.TL_PERP_MARK || 2000);
const CONTRACT_NOTIONAL = Number(process.env.TL_PERP_NOTIONAL || 1);
const CONTRACT_LEVERAGE = Number(process.env.TL_PERP_LEVERAGE || 1000);
const PERP_AMOUNT = Number(process.env.TL_PERP_AMOUNT || 1);
const SYNTH_AMOUNT = Number(process.env.TL_SYNTH_AMOUNT || 1);
const APPLY_IMMEDIATE = process.env.TL_APPLY_IMMEDIATE !== '0';
const BROADCAST = process.env.TL_BROADCAST !== '0';

function sats(ltc) {
  return Math.round(Number(ltc) * COIN);
}

function outAddress(vout) {
  return vout?.scriptPubKey?.address || (Array.isArray(vout?.scriptPubKey?.addresses) ? vout.scriptPubKey.addresses[0] : '');
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

async function newAddress(client, label) {
  return client.rpcCall('getnewaddress', [label, 'bech32'], true);
}

async function getPubkey(client, address) {
  const info = await client.rpcCall('getaddressinfo', [address], true);
  if (!info.pubkey) throw new Error(`No pubkey for ${address}`);
  return info.pubkey;
}

function makeP2wsh2of2(pubA, pubB) {
  const pubkeys = [Buffer.from(pubA, 'hex'), Buffer.from(pubB, 'hex')].sort(Buffer.compare);
  const redeem = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NETWORK });
  const p2wsh = bitcoin.payments.p2wsh({ redeem, network: NETWORK });
  return {
    address: p2wsh.address,
    witnessScript: redeem.output.toString('hex'),
    pubkeys: pubkeys.map((p) => p.toString('hex'))
  };
}

async function largestUtxo(client, address, minConf = 0) {
  const utxos = await client.listUnspent(minConf, 9999999, [address]);
  return (utxos || [])
    .filter((u) => Number(u.amount || 0) > 0 && u.spendable !== false)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
}

async function fundHotAddress(client, address) {
  let utxo = await largestUtxo(client, address, 0);
  if (utxo) return { txid: null, utxo };
  const txid = await client.rpcCall('sendtoaddress', [address, Number(process.env.TL_SECOND_FUNDER_LTC || 0.004)], true);
  for (let i = 0; i < 20; i += 1) {
    utxo = await largestUtxo(client, address, 0);
    if (utxo) return { txid, utxo };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Funding tx ${txid} did not produce a spendable UTXO for ${address}`);
}

async function buildGrantTx(client, hotAddress, dlcAddress, contractId) {
  const payload = Encode.encodeGrantManagedToken({
    propertyId: PROPERTY_ID,
    amountGranted: PLEDGE_AMOUNT,
    redeemAddress: dlcAddress,
    dlcTemplateId: TEMPLATE_ID,
    dlcContractId: contractId,
    settlementState: PROCEDURAL_STATES.FUNDED,
    dlcHash: DLC_HASH
  });
  const dataHex = Buffer.from(payload, 'utf8').toString('hex');
  const utxo = await largestUtxo(client, hotAddress, 0);
  if (!utxo) throw new Error(`No spendable UTXO for ${hotAddress}`);

  const inputAmount = Number(utxo.amount);
  const fee = Number(process.env.TL_GRANT_FEE || 0.00005);
  const change = Number((inputAmount - PLEDGE_AMOUNT - fee).toFixed(8));
  if (change <= 0) throw new Error(`UTXO ${utxo.txid}:${utxo.vout} too small for pledge`);

  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: utxo.txid, vout: utxo.vout }],
    [
      { [dlcAddress]: PLEDGE_AMOUNT },
      { data: dataHex },
      { [hotAddress]: change }
    ]
  ], false);
  const signed = await client.signrawtransactionwithwallet(raw);
  if (!signed.complete) throw new Error('wallet did not sign grant tx completely');
  const decoded = await client.decoderawtransaction(signed.hex);
  const accept = await client.rpcCall('testmempoolaccept', [[signed.hex]], false);
  const txid = BROADCAST ? await client.sendrawtransaction(signed.hex) : decoded.txid;
  return { txid, hex: signed.hex, decoded, accept, payload };
}

async function applyGrant(grant, hotAddress, block) {
  const referenceOutputs = grant.decoded.vout
    .filter((v) => v.n === 0 || v.n === 1)
    .filter((v) => v?.scriptPubKey?.type !== 'nulldata')
    .map((v) => ({
      vout: v.n,
      address: outAddress(v),
      satoshis: sats(v.value)
    }))
    .filter((o) => o.address);

  const params = await Types.decodePayload(
    grant.txid,
    11,
    'tl',
    grant.payload.slice(3),
    hotAddress,
    referenceOutputs,
    0,
    referenceOutputs.reduce((sum, o) => sum + o.satoshis, 0),
    block
  );
  if (!params.valid) throw new Error(`grant invalid: ${params.reason}`);
  if (APPLY_IMMEDIATE) {
    await Logic.typeSwitch(11, params);
    await Consensus.markTxAsProcessed(grant.txid, params);
  }
  return { params, referenceOutputs };
}

async function ensurePerpContract(block) {
  const markBlock = Math.max(1, block - 1);
  const contractId = await ContractRegistry.createContractSeries(FIRST_FUNDER, {
    native: true,
    underlyingOracleId: 0,
    onChainData: [[PROPERTY_ID, 0]],
    notionalPropertyId: 0,
    notionalValue: CONTRACT_NOTIONAL,
    collateralPropertyId: PROPERTY_ID,
    leverage: CONTRACT_LEVERAGE,
    expiryPeriod: 0,
    series: 1,
    inverse: true,
    fee: false,
    whitelist: 0
  }, block);
  await VolumeIndex.saveVolumeDataById(`${PROPERTY_ID}-0`, PERP_AMOUNT, PERP_AMOUNT, MARK_PRICE, markBlock, 'token');
  await VolumeIndex.saveVolumeDataById(`0-${PROPERTY_ID}`, PERP_AMOUNT, PERP_AMOUNT, MARK_PRICE, markBlock, 'token');
  return contractId;
}

async function ensureTxTypeActive(txType, block) {
  const activation = Activation.getInstance();
  await activation.init();
  const isActive = await activation.isTxTypeActive(txType);
  if (isActive) return { txType, changed: false };
  const activationBlock = Math.max(1, block - 1);
  const result = await activation.activate(txType, activationBlock, `ltc-dlc-perp-tlusd-demo-${txType}`);
  return { txType, changed: true, activationBlock, result };
}

async function processPerpTrade(contractId, longAddress, shortAddress, block) {
  const initialMargin = await ContractRegistry.getInitialMargin(contractId, MARK_PRICE);
  const orderbook = await Orderbook.getOrderbookInstance(String(contractId));
  const txid = `headless-perp-${Date.now()}-${shortId()}`;
  const match = {
    sellOrder: {
      contractId,
      amount: PERP_AMOUNT,
      price: MARK_PRICE,
      block,
      sellSide: true,
      marginUsed: initialMargin * PERP_AMOUNT,
      sellerAddress: shortAddress,
      txid,
      maker: true
    },
    buyOrder: {
      contractId,
      amount: PERP_AMOUNT,
      price: MARK_PRICE,
      block,
      buySide: true,
      marginUsed: initialMargin * PERP_AMOUNT,
      buyerAddress: longAddress,
      txid,
      maker: false
    },
    price: MARK_PRICE,
    tradePrice: MARK_PRICE,
    txid
  };
  await orderbook.processContractMatches([match], block, false);
  return { txid, initialMargin };
}

async function mintTlusd(contractId, shortAddress, block) {
  const params = {
    propertyId: PROPERTY_ID,
    contractId,
    amount: SYNTH_AMOUNT,
    senderAddress: shortAddress,
    block,
    txid: `headless-mint-${Date.now()}-${shortId()}`
  };
  const Validity = require('../src/validity.js');
  const checked = await Validity.validateMintSynthetic(shortAddress, params, params.txid);
  if (!checked.valid) throw new Error(`mint invalid: ${checked.reason}`);
  await Logic.mintSynthetic(
    shortAddress,
    checked.propertyId,
    checked.contractId,
    checked.amount,
    block,
    checked.grossRequired,
    checked.contracts,
    checked.margin
  );
  await Consensus.markTxAsProcessed(checked.txid, checked);
  return checked;
}

async function main() {
  await TxUtils.init();
  const client = TxUtils.client;
  const run = `${Date.now()}-${shortId()}`;
  const block = Number(process.env.TL_HEADLESS_BLOCK || await client.getBlockCount());

  const hot2 = process.env.TL_SECOND_FUNDER || await newAddress(client, `tl-dlc-funder-${run}`);
  const partyA = await newAddress(client, `tl-dlc-party-a-${run}`);
  const partyB = await newAddress(client, `tl-dlc-party-b-${run}`);
  const dlc = makeP2wsh2of2(await getPubkey(client, partyA), await getPubkey(client, partyB));
  const contractId = process.env.TL_DLC_CONTRACT_ID || `ltc-testnet-epoch-2-${run}`;

  await ProceduralRegistry.upsertTemplate(TEMPLATE_ID, {
    dlcHash: DLC_HASH,
    templateHash: DLC_HASH,
    state: PROCEDURAL_STATES.TEMPLATE,
    source: 'ltc-second-funder-dry-run'
  });
  await ProceduralRegistry.upsertContract(contractId, TEMPLATE_ID, PROCEDURAL_STATES.FUNDED, {
    dlcHash: DLC_HASH,
    redeemAddress: dlc.address,
    witnessScript: dlc.witnessScript,
    pubkeys: dlc.pubkeys,
    live: true,
    source: 'ltc-second-funder-dry-run'
  });

  const funding = await fundHotAddress(client, hot2);
  const grant = await buildGrantTx(client, hot2, dlc.address, contractId);
  const grantApplied = await applyGrant(grant, hot2, block);
  const syntheticActivation = await ensureTxTypeActive(24, block);
  const perpContractId = await ensurePerpContract(block);
  const trade = await processPerpTrade(perpContractId, FIRST_FUNDER, hot2, block);
  const mint = await mintTlusd(perpContractId, hot2, block);

  const marginMap = await MarginMap.getInstance(perpContractId);
  const firstBalance = await TallyMap.getTally(FIRST_FUNDER, PROPERTY_ID);
  const secondBalance = await TallyMap.getTally(hot2, PROPERTY_ID);
  const secondSynth = await TallyMap.getTally(hot2, `s-${PROPERTY_ID}-${perpContractId}`);
  const summary = {
    run,
    broadcast: BROADCAST,
    applyImmediate: APPLY_IMMEDIATE,
    firstFunder: FIRST_FUNDER,
    secondFunder: hot2,
    fundingTxid: funding.txid,
    dlc: {
      address: dlc.address,
      type: 'p2wsh-2-of-2',
      partyA,
      partyB,
      witnessScript: dlc.witnessScript,
      pubkeys: dlc.pubkeys
    },
    procedural: {
      propertyId: PROPERTY_ID,
      templateId: TEMPLATE_ID,
      contractId,
      dlcHash: DLC_HASH,
      pledgeAmount: PLEDGE_AMOUNT
    },
    grant: {
      txid: grant.txid,
      mempoolAccept: grant.accept,
      params: grantApplied.params,
      referenceOutputs: grantApplied.referenceOutputs
    },
    activations: {
      syntheticMint: syntheticActivation
    },
    perp: {
      contractId: perpContractId,
      tradeTxid: trade.txid,
      markPrice: MARK_PRICE,
      notional: CONTRACT_NOTIONAL,
      leverage: CONTRACT_LEVERAGE,
      amount: PERP_AMOUNT,
      initialMargin: trade.initialMargin,
      longAddress: FIRST_FUNDER,
      shortAddress: hot2,
      longPosition: await marginMap.getPositionForAddress(FIRST_FUNDER, perpContractId),
      shortPosition: await marginMap.getPositionForAddress(hot2, perpContractId)
    },
    tlusd: {
      syntheticId: `s-${PROPERTY_ID}-${perpContractId}`,
      amount: mint.amount,
      mintParams: mint,
      shortBalance: secondSynth
    },
    balances: {
      firstFunderProperty: firstBalance,
      secondFunderProperty: secondBalance
    }
  };

  const artifactDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, 'ltc-second-funder-dlc-perp-tlusd-latest.json');
  fs.writeFileSync(artifactPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ artifactPath, summary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
