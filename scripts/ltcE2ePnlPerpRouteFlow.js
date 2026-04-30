const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const bitcoin = require('bitcoinjs-lib');

const IS_BTC = String(process.env.CHAIN || '').toUpperCase().includes('BTC');
process.env.RPC_WALLET = process.env.RPC_WALLET || process.env.WALLET_NAME || (IS_BTC ? 'utxoref-testnet' : 'tl-wallet');

const Encode = require('../src/txEncoder.js');
const Types = require('../src/types.js');
const Logic = require('../src/logic.js');
const TxUtils = require('../src/txUtils.js');
const TallyMap = require('../src/tally.js');
const Consensus = require('../src/consensus.js');
const ContractRegistry = require('../src/contractRegistry.js');
const Channels = require('../src/channels.js');
const ClearList = require('../src/clearlist.js');
const MarginMap = require('../src/marginMap.js');
const Orderbook = require('../src/orderbook.js');
const PropertyManager = require('../src/property.js');
const Validity = require('../src/validity.js');
const Activation = require('../src/activation.js');
const { ProceduralRegistry, PROCEDURAL_STATES } = require('../src/procedural.js');

const COIN = 100000000;
const NETWORK = IS_BTC ? bitcoin.networks.testnet : {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'tltc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0x3a,
  wif: 0xef
};

const ARTIFACT_PREFIX = process.env.TL_ARTIFACT_PREFIX || (IS_BTC ? 'btctest' : 'ltc');
const CHAIN_LABEL = process.env.TL_CHAIN_LABEL || (IS_BTC ? 'bitcoin-testnet4' : 'litecoin-testnet');
const FIRST_FUNDER = process.env.TL_FIRST_FUNDER || (IS_BTC ? 'tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu' : 'tltc1qkz0vft2fc4nk0u9fx4k9yk4th7zherna3zxh22');
const PROPERTY_ID = Number(process.env.TL_PROCEDURAL_PROPERTY || 380);
const SPOT_PROPERTY_ID = Number(process.env.TL_SPOT_PROPERTY_ID || 5);
const SPOT_TOKEN_AMOUNT = Number(process.env.TL_SPOT_TOKEN_AMOUNT || 0.0000001);
const TEMPLATE_ID = process.env.TL_DLC_TEMPLATE_ID || `dlc-receipt-${ARTIFACT_PREFIX}-v1`;
const DLC_HASH = process.env.TL_DLC_HASH || '60e19d0c4f34a09a690e679230bf41a63252306e0e06a09e1b090efbcbb7b499';
const PLEDGE_AMOUNT = Number(process.env.TL_PLEDGE_AMOUNT || 0.001);
const SPOT_MARK_PRICE = Number(process.env.TL_SPOT_MARK_PRICE || 2200);
const ENTRY_PRICE = Number(process.env.TL_PERP_ENTRY || SPOT_MARK_PRICE);
const EXIT_PRICE = Number(process.env.TL_PERP_EXIT || (SPOT_MARK_PRICE * 1.02).toFixed(2));
const CONTRACT_NOTIONAL = Number(process.env.TL_PERP_NOTIONAL || 1);
const CONTRACT_LEVERAGE = Number(process.env.TL_PERP_LEVERAGE || 10);
const PERP_AMOUNT = Number(process.env.TL_PERP_AMOUNT || 1);
const MAX_MARK_DEVIATION_BPS = Number(process.env.TL_MAX_MARK_DEVIATION_BPS || 500);
const PUBLISH_CLOSE_SPOT_MARK = process.env.TL_CLOSE_SPOT_MARK === '1';
const CLOSE_SPOT_MARK_PRICE = Number(process.env.TL_CLOSE_SPOT_MARK_PRICE || EXIT_PRICE);
const BROADCAST = process.env.TL_BROADCAST !== '0';
const APPLY_IMMEDIATE = process.env.TL_APPLY_IMMEDIATE !== '0';
const DUST_COIN = Number(process.env.TL_DUST_COIN || 0.00000546);

function sats(ltc) {
  return Math.round(Number(ltc) * COIN);
}

function ltc(satoshis) {
  return Number((Number(satoshis) / COIN).toFixed(8));
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function markDeviationBps(price, mark) {
  return Math.abs(Number(price) - Number(mark)) / Number(mark) * 10000;
}

function assertWithinMarkBand(price, mark, label) {
  const deviationBps = markDeviationBps(price, mark);
  if (!Number.isFinite(deviationBps) || deviationBps > MAX_MARK_DEVIATION_BPS) {
    throw new Error(`${label} price ${price} is ${deviationBps.toFixed(2)} bps from mark ${mark}, max ${MAX_MARK_DEVIATION_BPS}`);
  }
  return Number(deviationBps.toFixed(2));
}

function outAddress(vout) {
  return vout?.scriptPubKey?.address || (Array.isArray(vout?.scriptPubKey?.addresses) ? vout.scriptPubKey.addresses[0] : '');
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
  const txid = await client.rpcCall('sendtoaddress', [address, Number(process.env.TL_SECOND_FUNDER_COIN || process.env.TL_SECOND_FUNDER_LTC || 0.004)], true);
  for (let i = 0; i < 20; i += 1) {
    utxo = await largestUtxo(client, address, 0);
    if (utxo) return { txid, utxo };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Funding tx ${txid} did not produce a spendable UTXO for ${address}`);
}

async function fundAddressForAmount(client, address, minAmount) {
  let utxo = await largestUtxo(client, address, 0);
  if (utxo && Number(utxo.amount) >= minAmount) return { txid: null, utxo };
  const txid = await client.rpcCall('sendtoaddress', [address, Number(process.env.TL_ADDRESS_TOPUP_COIN || process.env.TL_SPOT_CHANNEL_TOPUP_LTC || 0.004)], true);
  for (let i = 0; i < 20; i += 1) {
    utxo = await largestUtxo(client, address, 0);
    if (utxo && Number(utxo.amount) >= minAmount) return { txid, utxo };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Top-up tx ${txid} did not produce a large enough UTXO for ${address}`);
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
  const fee = Number(process.env.TL_GRANT_FEE || (IS_BTC ? 0.000015 : 0.00005));
  const required = Number((PLEDGE_AMOUNT + fee).toFixed(8));
  const funded = await fundAddressForAmount(client, hotAddress, required);
  const utxo = funded.utxo;
  const inputAmount = Number(utxo.amount);
  const change = Number((inputAmount - PLEDGE_AMOUNT - fee).toFixed(8));
  if (change < 0) throw new Error(`UTXO ${utxo.txid}:${utxo.vout} too small for pledge`);
  const outputs = [
    { [dlcAddress]: PLEDGE_AMOUNT },
    { data: Buffer.from(payload, 'utf8').toString('hex') }
  ];
  if (change >= DUST_COIN) outputs.push({ [hotAddress]: change });

  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: utxo.txid, vout: utxo.vout }],
    outputs
  ], false);
  const signed = await client.signrawtransactionwithwallet(raw);
  if (!signed.complete) throw new Error('wallet did not sign grant tx completely');
  const decoded = await client.decoderawtransaction(signed.hex);
  const accept = await client.rpcCall('testmempoolaccept', [[signed.hex]], false);
  const txid = BROADCAST ? await client.sendrawtransaction(signed.hex) : decoded.txid;
  return { txid, hex: signed.hex, decoded, accept, payload, fundingTxid: funded.txid };
}

async function applyGrant(grant, hotAddress, block, dlcAddress) {
  const referenceOutputs = grant.decoded.vout
    .filter((v) => v?.scriptPubKey?.type !== 'nulldata')
    .map((v) => ({ vout: v.n, address: outAddress(v), satoshis: sats(v.value) }))
    .filter((o) => o.address === dlcAddress);

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

async function ensureCollateralGrant(client, hotAddress, dlcAddress, contractId, block, minAvailable) {
  const tally = await TallyMap.getTally(hotAddress, PROPERTY_ID);
  if (Number(tally?.available || 0) >= minAvailable) return null;
  const grant = await buildGrantTx(client, hotAddress, dlcAddress, contractId);
  const applied = await applyGrant(grant, hotAddress, block, dlcAddress);
  return {
    txid: grant.txid,
    mempoolAccept: grant.accept,
    params: applied.params,
    referenceOutputs: applied.referenceOutputs
  };
}

async function ensureTxTypeActive(txType, block) {
  const activation = Activation.getInstance();
  await activation.init();
  if (!activation.txRegistry?.[txType]) {
    const defaults = activation.initializeTxRegistry();
    if (defaults[txType]) {
      activation.txRegistry[txType] = defaults[txType];
      await activation.saveActivationsList();
    }
  }
  const isActive = await activation.isTxTypeActive(txType);
  if (isActive) return { txType, changed: false };
  const activationBlock = Math.max(1, block - 1);
  const result = await activation.activate(txType, activationBlock, `ltc-e2e-pnl-flow-${txType}`);
  return { txType, changed: true, activationBlock, result };
}

async function seedSpotChannel(channelAddress, propertyId, amount, block) {
  await PropertyManager.load();
  const existing = await PropertyManager.getPropertyData(propertyId);
  if (!existing) {
    const manager = PropertyManager.getInstance();
    await manager.addProperty(
      propertyId,
      process.env.TL_SPOT_TICKER || `SPOT${propertyId}`,
      Number(process.env.TL_SPOT_TOTAL || 1),
      'Fixed',
      0,
      FIRST_FUNDER,
      ''
    );
  }

  const seededAmount = Number((amount * 4).toFixed(8));
  await Channels.setChannel(channelAddress, {
    channel: channelAddress,
    participants: { A: channelAddress, B: '' },
    A: { [propertyId]: seededAmount },
    B: {},
    commits: [{
      senderAddress: channelAddress,
      propertyId,
      amount: seededAmount,
      columnAssigned: 'A',
      txid: `spot-channel-seed-${shortId()}`,
      block
    }],
    lastUsedColumn: 'A',
    lastCommitmentTime: block
  });

  const tally = await TallyMap.getTally(channelAddress, propertyId);
  const currentChannel = Number(tally?.channel || 0);
  if (currentChannel < seededAmount) {
    await TallyMap.updateChannelBalance(
      channelAddress,
      propertyId,
      Number((seededAmount - currentChannel).toFixed(8)),
      'spotMarkChannelSeed',
      block
    );
  }
}

async function buildSpotMarkTx(client, channelAddress, tokenDeliveryAddress, propertyId, tokenAmount, price, block) {
  const coinAmount = Number((tokenAmount * price).toFixed(8));
  const paymentSats = sats(coinAmount);
  const payload = Encode.encodeTradeTokenForUTXO({
    propertyId,
    amount: tokenAmount,
    columnA: true,
    satsExpected: coinAmount,
    tokenOutput: 0,
    payToAddress: 1,
    isColoredOutput: false
  });

  const dust = Number(process.env.TL_SPOT_DUST_LTC || DUST_COIN);
  const fee = Number(process.env.TL_SPOT_FEE_COIN || process.env.TL_SPOT_FEE_LTC || (IS_BTC ? 0.000015 : 0.00005));
  const required = Number((coinAmount + dust + fee).toFixed(8));
  const availableUtxo = await largestUtxo(client, channelAddress, 0);
  const inputAmount = Number(availableUtxo?.amount || 0);
  const funded = inputAmount >= required
    ? { txid: null, utxo: availableUtxo }
    : await fundAddressForAmount(client, channelAddress, required);
  const spendUtxo = funded.utxo;
  const spendAmount = Number(spendUtxo.amount);
  const change = Number((spendAmount - coinAmount - dust - fee).toFixed(8));
  const changeAddress = await newAddress(client, `tl-e2e-pnl-spot-change-${shortId()}`);
  if (change < 0) {
    throw new Error(`Spot mark UTXO ${spendUtxo.txid}:${spendUtxo.vout} too small for ${coinAmount} LTC mark payment`);
  }
  const outputs = [
    { [tokenDeliveryAddress]: dust },
    { [channelAddress]: coinAmount },
    { data: Buffer.from(payload, 'utf8').toString('hex') }
  ];
  if (change >= DUST_COIN) outputs.push({ [changeAddress]: change });

  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: spendUtxo.txid, vout: spendUtxo.vout }],
    outputs
  ], false);
  const signed = await client.signrawtransactionwithwallet(raw);
  if (!signed.complete) throw new Error('wallet did not sign spot mark tx completely');
  const decoded = await client.decoderawtransaction(signed.hex);
  const accept = await client.rpcCall('testmempoolaccept', [[signed.hex]], false);
  const txid = BROADCAST ? await client.sendrawtransaction(signed.hex) : decoded.txid;
  return {
    txid,
    hex: signed.hex,
    decoded,
    accept,
    payload,
    coinAmount,
    paymentSats,
    fundingTxid: funded.txid,
    changeAddress
  };
}

async function applySpotMarkTx(spot, channelAddress, block) {
  const referenceOutputs = spot.decoded.vout
    .filter((v) => v?.scriptPubKey?.type !== 'nulldata')
    .map((v) => ({ vout: v.n, address: outAddress(v), satoshis: sats(v.value), value: v.value }));

  const params = await Types.decodePayload(
    spot.txid,
    3,
    'tl',
    spot.payload.slice(3),
    channelAddress,
    referenceOutputs,
    0,
    spot.paymentSats,
    block
  );
  if (!params.valid) throw new Error(`spot tx3 invalid: ${params.reason}`);
  if (APPLY_IMMEDIATE) {
    await Logic.typeSwitch(3, params);
    await Consensus.markTxAsProcessed(spot.txid, params);
  }
  return { params, referenceOutputs };
}

async function createSpotMark(client, channelAddress, tokenDeliveryAddress, price, block, label) {
  const spot = await buildSpotMarkTx(
    client,
    channelAddress,
    tokenDeliveryAddress,
    SPOT_PROPERTY_ID,
    SPOT_TOKEN_AMOUNT,
    price,
    block
  );
  const applied = await applySpotMarkTx(spot, channelAddress, block);
  return {
    label,
    txid: spot.txid,
    price,
    tokenAmount: SPOT_TOKEN_AMOUNT,
    propertyId: SPOT_PROPERTY_ID,
    coinAmount: spot.coinAmount,
    paymentSats: spot.paymentSats,
    fundingTxid: spot.fundingTxid,
    changeAddress: spot.changeAddress,
    mempoolAccept: spot.accept,
    params: applied.params,
    referenceOutputs: applied.referenceOutputs
  };
}

async function ensurePerpContract(block) {
  const contractId = await ContractRegistry.createContractSeries(FIRST_FUNDER, {
    native: true,
    underlyingOracleId: 0,
    onChainData: [[0, SPOT_PROPERTY_ID]],
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
  return contractId;
}

async function processPerpMatch(contractId, longAddress, shortAddress, price, block, txLabel) {
  const initialMargin = await ContractRegistry.getInitialMargin(contractId, price);
  const orderbook = await Orderbook.getOrderbookInstance(String(contractId));
  const txid = `${txLabel}-${Date.now()}-${shortId()}`;
  const match = {
    sellOrder: {
      contractId,
      amount: PERP_AMOUNT,
      price,
      block,
      sell: true,
      sellSide: true,
      marginUsed: initialMargin * PERP_AMOUNT,
      sellerAddress: shortAddress,
      txid,
      sellerTx: txid,
      maker: true
    },
    buyOrder: {
      contractId,
      amount: PERP_AMOUNT,
      price,
      block,
      sell: false,
      buySide: true,
      marginUsed: initialMargin * PERP_AMOUNT,
      buyerAddress: longAddress,
      txid,
      buyerTx: txid,
      maker: false
    },
    price,
    tradePrice: price,
    txid
  };
  await orderbook.processContractMatches([match], block, false);
  return { txid, initialMargin, price };
}

async function validatePerpLeg(sender, contractId, price, amount, sell, block, txid) {
  const referenceMark = await Validity.hasReferencePrice(contractId, block);
  const params = {
    senderAddress: sender,
    contractId,
    price,
    amount,
    sell,
    insurance: false,
    reduce: false,
    post: false,
    stop: false,
    block,
    txid
  };
  const result = await Validity.validateTradeContractOnchain(sender, params, txid);
  if (!result.valid) {
    throw new Error(`tx18 validation failed for ${txid}: ${result.reason}`);
  }
  const deviationBps = referenceMark
    ? Number((Math.abs(price - Number(referenceMark)) / Number(referenceMark) * 10000).toFixed(2))
    : null;
  return {
    ...result,
    referenceMark,
    deviationBps,
    maxDeviationBps: 500
  };
}

function inverseLongPnl(entryPrice, exitPrice, contracts, notional) {
  return Number(((1 / entryPrice - 1 / exitPrice) * contracts * notional).toFixed(8));
}

function runNodeScript(script, env) {
  execFileSync(process.execPath, [script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout: Number(process.env.TL_E2E_CHILD_TIMEOUT_MS || 180000)
  });
}

async function main() {
  await TxUtils.init();
  const client = TxUtils.client;
  const run = `${Date.now()}-${shortId()}`;
  const block = Number(process.env.TL_HEADLESS_BLOCK || await client.getBlockCount());
  const closeBlock = block + 1;
  const configuredDeviation = {
    openBps: assertWithinMarkBand(ENTRY_PRICE, SPOT_MARK_PRICE, 'open'),
    closeBps: assertWithinMarkBand(EXIT_PRICE, SPOT_MARK_PRICE, 'close')
  };

  await ensureTxTypeActive(11, block);
  await ensureTxTypeActive(3, block);
  await ensureTxTypeActive(18, block);
  await ensureTxTypeActive(24, block);

  const secondFunder = process.env.TL_SECOND_FUNDER || await newAddress(client, `tl-e2e-pnl-funder-${run}`);
  const partyA = await newAddress(client, `tl-e2e-pnl-party-a-${run}`);
  const partyB = await newAddress(client, `tl-e2e-pnl-party-b-${run}`);
  const dlc = makeP2wsh2of2(await getPubkey(client, partyA), await getPubkey(client, partyB));
  const dlcContractId = process.env.TL_DLC_CONTRACT_ID || `${ARTIFACT_PREFIX}-pnl-e2e-${run}`;

  await ProceduralRegistry.upsertTemplate(TEMPLATE_ID, {
    dlcHash: DLC_HASH,
    templateHash: DLC_HASH,
    state: PROCEDURAL_STATES.TEMPLATE,
    source: 'ltc-e2e-pnl-route-flow'
  });
  await ProceduralRegistry.upsertContract(dlcContractId, TEMPLATE_ID, PROCEDURAL_STATES.FUNDED, {
    dlcHash: DLC_HASH,
    redeemAddress: dlc.address,
    witnessScript: dlc.witnessScript,
    pubkeys: dlc.pubkeys,
    live: true,
    source: 'ltc-e2e-pnl-route-flow'
  });

  const funding = await fundHotAddress(client, secondFunder);
  const spotChannel = process.env.TL_SPOT_CHANNEL || await newAddress(client, `tl-e2e-pnl-spot-channel-${run}`);
  const spotTokenDelivery = process.env.TL_SPOT_TOKEN_DELIVERY || await newAddress(client, `tl-e2e-pnl-spot-delivery-${run}`);
  const spotFunding = await fundHotAddress(client, spotChannel);
  await seedSpotChannel(spotChannel, SPOT_PROPERTY_ID, SPOT_TOKEN_AMOUNT, block);
  await ClearList.addAttestation(0, secondFunder, 'CA', block);
  await ClearList.addAttestation(0, FIRST_FUNDER, 'CA', block);
  const grant = await buildGrantTx(client, secondFunder, dlc.address, dlcContractId);
  const grantApplied = await applyGrant(grant, secondFunder, block, dlc.address);
  const contractId = await ensurePerpContract(block);
  const longGrant = await ensureCollateralGrant(
    client,
    FIRST_FUNDER,
    dlc.address,
    dlcContractId,
    block,
    PLEDGE_AMOUNT
  );
  const anchorSpotMark = await createSpotMark(client, spotChannel, spotTokenDelivery, SPOT_MARK_PRICE, block, 'anchor');

  const balancesBeforeOpen = {
    long: await TallyMap.getTally(FIRST_FUNDER, PROPERTY_ID),
    short: await TallyMap.getTally(secondFunder, PROPERTY_ID)
  };
  const openValidation = {
    long: await validatePerpLeg(FIRST_FUNDER, contractId, ENTRY_PRICE, PERP_AMOUNT, false, block, `valid-open-long-${run}`),
    short: await validatePerpLeg(secondFunder, contractId, ENTRY_PRICE, PERP_AMOUNT, true, block, `valid-open-short-${run}`)
  };
  const openTrade = await processPerpMatch(contractId, FIRST_FUNDER, secondFunder, ENTRY_PRICE, block, 'headless-open-perp');

  const closeSpotMark = PUBLISH_CLOSE_SPOT_MARK
    ? await createSpotMark(client, spotChannel, spotTokenDelivery, CLOSE_SPOT_MARK_PRICE, closeBlock, 'close')
    : null;
  const closeValidation = {
    long: await validatePerpLeg(FIRST_FUNDER, contractId, EXIT_PRICE, PERP_AMOUNT, true, closeBlock, `valid-close-long-${run}`),
    short: await validatePerpLeg(secondFunder, contractId, EXIT_PRICE, PERP_AMOUNT, false, closeBlock, `valid-close-short-${run}`)
  };
  const closeTrade = await processPerpMatch(contractId, secondFunder, FIRST_FUNDER, EXIT_PRICE, closeBlock, 'headless-close-perp');

  const marginMap = await MarginMap.getInstance(contractId);
  const balancesAfterClose = {
    long: await TallyMap.getTally(FIRST_FUNDER, PROPERTY_ID),
    short: await TallyMap.getTally(secondFunder, PROPERTY_ID)
  };
  const longPnl = inverseLongPnl(ENTRY_PRICE, EXIT_PRICE, PERP_AMOUNT, CONTRACT_NOTIONAL);
  const winner = longPnl >= 0 ? FIRST_FUNDER : secondFunder;
  const loser = longPnl >= 0 ? secondFunder : FIRST_FUNDER;
  const pnlAmount = Math.abs(longPnl);

  const baseArtifact = {
    run,
    chain: CHAIN_LABEL,
    broadcast: BROADCAST,
    applyImmediate: APPLY_IMMEDIATE,
    firstFunder: FIRST_FUNDER,
    secondFunder,
    fundingTxid: funding.txid,
    spotMarkSource: {
      pair: `0-${SPOT_PROPERTY_ID}`,
      propertyId: SPOT_PROPERTY_ID,
      channelAddress: spotChannel,
      tokenDeliveryAddress: spotTokenDelivery,
      fundingTxid: spotFunding.txid,
      tokenAmount: SPOT_TOKEN_AMOUNT,
      currentMark: SPOT_MARK_PRICE,
      maxDeviationBps: MAX_MARK_DEVIATION_BPS,
      configuredDeviation,
      anchor: anchorSpotMark,
      entry: anchorSpotMark,
      close: closeSpotMark,
      closeMarkPublished: Boolean(closeSpotMark)
    },
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
      contractId: dlcContractId,
      dlcHash: DLC_HASH,
      pledgeAmount: PLEDGE_AMOUNT
    },
    grant: {
      txid: grant.txid,
      mempoolAccept: grant.accept,
      params: grantApplied.params,
      referenceOutputs: grantApplied.referenceOutputs
    },
    longGrant,
    perp: {
      contractId,
      entryPrice: ENTRY_PRICE,
      exitPrice: EXIT_PRICE,
      amount: PERP_AMOUNT,
      notional: CONTRACT_NOTIONAL,
      leverage: CONTRACT_LEVERAGE,
      openTrade,
      closeTrade,
      validation: {
        open: openValidation,
        close: closeValidation
      },
      longAddress: FIRST_FUNDER,
      shortAddress: secondFunder,
      longPosition: await marginMap.getPositionForAddress(FIRST_FUNDER, contractId),
      shortPosition: await marginMap.getPositionForAddress(secondFunder, contractId),
      computedLongPnl: longPnl
    },
    pnlTransfer: {
      fromAddress: loser,
      toAddress: winner,
      tokenAmount: pnlAmount
    },
    balancesBeforeOpen,
    balancesAfterClose
  };

  const artifactDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  const secondFunderArtifact = path.join(artifactDir, `${ARTIFACT_PREFIX}-second-funder-dlc-perp-tlusd-latest.json`);
  fs.writeFileSync(secondFunderArtifact, JSON.stringify(baseArtifact, null, 2));

  runNodeScript(path.join('scripts', 'ltcRevealPnlPayoutVector.js'), {
    TL_ARTIFACT_PREFIX: ARTIFACT_PREFIX,
    TL_CHAIN_LABEL: CHAIN_LABEL,
    TL_DLC_ARTIFACT: secondFunderArtifact,
    TL_PNL_FROM: loser,
    TL_PNL_TO: winner,
    TL_PNL_SWEEP_AMOUNT: String(pnlAmount),
    TL_PNL_DLC_REF: dlcContractId,
    TL_STATE_ORACLE_ADDRESS: process.env.TL_STATE_ORACLE_ADDRESS || secondFunder,
    TL_REVEAL_DESTINATION: winner
  });

  runNodeScript(path.join('scripts', 'ltcResolvePnlUtxoRouteFromWitness.js'), {
    TL_ARTIFACT_PREFIX: ARTIFACT_PREFIX,
    TL_DLC_ARTIFACT: secondFunderArtifact,
    TL_BUILD_DLC_SPEND: '1',
    TL_BROADCAST_DLC_PAYOUT: process.env.TL_BROADCAST_DLC_PAYOUT || '1'
  });

  const routePlan = JSON.parse(fs.readFileSync(path.join(artifactDir, `${ARTIFACT_PREFIX}-pnl-utxo-route-plan-latest.json`), 'utf8'));
  const verifyTradeLayerPnlRoutePlan = require('C:/projects/UTXORef/UTXO-Ref/bitvm3/utxo_referee/tradelayer_pnl_route_adapter').verifyTradeLayerPnlRoutePlan;
  const utxoRefVerification = verifyTradeLayerPnlRoutePlan(routePlan);
  const finalSummary = {
    ...baseArtifact,
    witnessReveal: JSON.parse(fs.readFileSync(path.join(artifactDir, `${ARTIFACT_PREFIX}-pnl-witness-reveal-latest.json`), 'utf8')),
    routePlan,
    utxoRefVerification
  };
  const out = path.join(artifactDir, `${ARTIFACT_PREFIX}-e2e-pnl-perp-route-flow-latest.json`);
  fs.writeFileSync(out, JSON.stringify(finalSummary, null, 2));
  console.log(JSON.stringify({ artifactPath: out, summary: finalSummary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
