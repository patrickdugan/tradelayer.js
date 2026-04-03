const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Encode = require('../src/txEncoder');
const OracleList = require('../src/oracle');
const PropertyList = require('../src/property');
const ContractRegistry = require('../src/contractRegistry');
const { ProceduralRegistry } = require('../src/procedural');
const { createOracleSigner } = require('./makeshiftOracle');

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : String(v);
}

function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function benv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function parseTL(scriptHex) {
  const markerHex = '746c';
  const pos = String(scriptHex || '').indexOf(markerHex);
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString();
  if (!ascii.startsWith('tl')) return null;
  const type = parseInt(ascii.slice(2, 3), 36);
  if (!Number.isFinite(type)) return null;
  return { marker: 'tl', type, encodedPayload: ascii.slice(3) };
}

async function applyTxNow(txid, senderAddress, blockHeight) {
  const tx = await TxUtils.getRawTransaction(txid);
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTL(opret?.scriptPubKey?.hex || '');
  if (!parsed) throw new Error(`No TL payload found for tx ${txid}`);

  const decoded = await Types.decodePayload(
    txid,
    parsed.type,
    parsed.marker,
    parsed.encodedPayload,
    senderAddress,
    null,
    0,
    0,
    blockHeight
  );
  decoded.block = blockHeight;
  if (decoded.valid !== true) {
    throw new Error(`tx invalid ${txid}: ${decoded.reason || 'unknown'}`);
  }
  await Logic.typeSwitch(parsed.type, decoded);
  return { type: parsed.type, decoded };
}

async function broadcastPayload(senderAddress, payload) {
  const litecore = require('bitcore-lib-ltc');
  const utxo = await TxUtils.findSuitableUTXO(senderAddress, 2000);
  const privateKey = await TxUtils.client.dumpprivkey(senderAddress);
  const tx = new litecore.Transaction()
    .from(utxo)
    .addData(payload)
    .change(senderAddress)
    .fee(2000);
  tx.sign(privateKey);
  return TxUtils.client.sendrawtransaction(tx.serialize());
}

async function activateIfNeeded(adminAddress, txType, applyImmediate) {
  const activation = Activation.getInstance();
  const alreadyActive = await activation.isTxTypeActive(txType);
  if (alreadyActive) return null;
  const txid = await TxUtils.activationTransaction(adminAddress, txType);
  if (applyImmediate) {
    const block = await TxUtils.getBlockCount();
    await applyTxNow(txid, adminAddress, block);
  }
  return txid;
}

async function issueManagedProperty(admin, ticker, applyImmediate, proceduralType = 1) {
  const issueTx = await broadcastPayload(admin, Encode.encodeTokenIssue({
    initialAmount: 1,
    ticker,
    whitelists: [],
    managed: true,
    backupAddress: '',
    nft: false,
    coloredCoinHybrid: false,
    proceduralType
  }));
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(issueTx, admin, b);
  }
  const props = await PropertyList.getPropertyIndex();
  const prop = props.find((p) => p.ticker === ticker);
  if (!prop?.id) throw new Error(`Unable to resolve property id for ${ticker}`);
  return { txid: issueTx, propertyId: Number(prop.id) };
}

async function createOracle(admin, ticker, applyImmediate) {
  const createTx = await broadcastPayload(admin, Encode.encodeCreateOracle({
    ticker,
    url: '',
    backupAddress: '',
    whitelists: [],
    lag: 1
  }));
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(createTx, admin, b);
  }
  const allOracles = await OracleList.getAllOracles();
  const newest = allOracles.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  const oracleId = Number(newest?.id || 0);
  if (!oracleId) throw new Error(`Unable to resolve oracle id for ${ticker}`);
  return { txid: createTx, oracleId };
}

function mkRelayBlob(bundle) {
  return JSON.stringify(bundle);
}

async function relaySettlement(oracleAdmin, params, settlement, signer, applyImmediate) {
  const signed = signer.signBundle({
    eventId: settlement.eventId,
    outcome: settlement.outcome || 'SETTLED',
    outcomeIndex: 0,
    stateHash: settlement.stateHash,
    timestamp: Math.floor(Date.now() / 1000)
  });

  const txid = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: params.oracleId,
    relayType: 1,
    stateHash: settlement.stateHash,
    dlcRef: params.dlcRef,
    settlementState: settlement.settlementState || 'SETTLED',
    relayBlob: mkRelayBlob({
      ...signed,
      settlement: settlement.payload
    })
  });

  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(txid, oracleAdmin, b);
  }
  return txid;
}

async function main() {
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const admin = env('TL_ADMIN_ADDRESS');
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS', admin);
  const alice = env('TL_ALICE_ADDRESS');
  const bob = env('TL_BOB_ADDRESS');
  const shortAmount = nenv('TL_SHORT_AMOUNT', 0.005);
  const redeemAmount = nenv('TL_REDEEM_AMOUNT', 0.001);
  const basePrice = nenv('TL_PRICE', 106);
  const leverage = nenv('TL_LEVERAGE', 10);
  const longExpiry = nenv('TL_LONG_EXPIRY_BLOCKS', 144);
  const series = nenv('TL_SERIES_COUNT', 1);
  const stateOracleTicker = env('TL_STATE_ORACLE_TICKER', 'BITVMSTATE');
  const priceOracleTicker = env('TL_PRICE_ORACLE_TICKER', 'LTCUSD');
  const shortTicker = env('TL_SHORT_TICKER', `DBS${Date.now().toString().slice(-5)}`);
  const longTicker = env('TL_LONG_TICKER', `DBL${Date.now().toString().slice(-5)}`);
  const templateId = env('TL_TEMPLATE_ID', `tpl-bitvm-${Date.now()}`);
  const shortContractRef = env('TL_SHORT_CONTRACT_REF', 'bitvm-epoch-1');
  const longContractRef = env('TL_LONG_CONTRACT_REF', 'bitvm-epoch-2');

  if (!admin || !oracleAdmin || !alice || !bob) {
    throw new Error('Missing TL_ADMIN_ADDRESS / TL_ORACLE_ADMIN_ADDRESS / TL_ALICE_ADDRESS / TL_BOB_ADDRESS');
  }

  await TxUtils.init();
  const activation = Activation.getInstance();
  await activation.init();

  const chain = await TxUtils.client.getBlockchainInfo();
  if (chain.chain !== 'test') throw new Error(`Expected testnet, got ${chain.chain}`);

  const activated = [];
  for (const txType of [1, 11, 12, 13, 14, 16, 18, 30]) {
    activated.push({ txType, txid: await activateIfNeeded(admin, txType, applyImmediate) });
  }

  const stateOracle = await createOracle(oracleAdmin, stateOracleTicker, applyImmediate);
  const priceOracle = await createOracle(oracleAdmin, priceOracleTicker, applyImmediate);

  const shortProp = await issueManagedProperty(admin, shortTicker, applyImmediate, 1);
  const longProp = await issueManagedProperty(admin, longTicker, applyImmediate, 1);

  await ProceduralRegistry.upsertTemplate(templateId, {
    oracleId: stateOracle.oracleId,
    collateralPropertyId: shortProp.propertyId,
    receiptPropertyId: shortProp.propertyId,
    templateHash: `${templateId}-hash`
  });
  await ProceduralRegistry.upsertContract(shortContractRef, templateId, 'FUNDED', { epoch: 1 });
  await ProceduralRegistry.upsertContract(longContractRef, templateId, 'FUNDED', { epoch: 2 });

  const grants = [];
  for (const [address, amount] of [[alice, shortAmount], [bob, shortAmount]]) {
    const txid = await TxUtils.createGrantManagedTokenTransaction(admin, {
      propertyId: shortProp.propertyId,
      amountGranted: amount,
      addressToGrantTo: address,
      dlcTemplateId: templateId,
      dlcContractId: shortContractRef,
      settlementState: 'FUNDED',
      dlcHash: `${templateId}-hash`
    });
    grants.push({ address, amount, txid });
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(txid, admin, b);
    }
  }

  const signer = createOracleSigner();
  const rollTxA = await relaySettlement(oracleAdmin, {
    oracleId: stateOracle.oracleId,
    dlcRef: shortContractRef
  }, {
    eventId: `${shortContractRef}-roll-a`,
    stateHash: `${shortContractRef}-roll-a`,
    settlementState: 'ROLLED',
    payload: {
      mode: 'rollover',
      propertyId: shortProp.propertyId,
      nextPropertyId: longProp.propertyId,
      amount: shortAmount,
      fromAddress: alice,
      toAddress: alice
    }
  }, signer, applyImmediate);

  const rollTxB = await relaySettlement(oracleAdmin, {
    oracleId: stateOracle.oracleId,
    dlcRef: shortContractRef
  }, {
    eventId: `${shortContractRef}-roll-b`,
    stateHash: `${shortContractRef}-roll-b`,
    settlementState: 'ROLLED',
    payload: {
      mode: 'rollover',
      propertyId: shortProp.propertyId,
      nextPropertyId: longProp.propertyId,
      amount: shortAmount,
      fromAddress: bob,
      toAddress: bob
    }
  }, signer, applyImmediate);

  const redeemTx = await relaySettlement(oracleAdmin, {
    oracleId: stateOracle.oracleId,
    dlcRef: longContractRef
  }, {
    eventId: `${longContractRef}-redeem-b`,
    stateHash: `${longContractRef}-redeem-b`,
    settlementState: 'CLOSED',
    payload: {
      mode: 'redeem',
      propertyId: longProp.propertyId,
      amount: redeemAmount,
      fromAddress: bob
    }
  }, signer, applyImmediate);

  const priceTx = await TxUtils.publishDataTransaction(oracleAdmin, {
    oracleid: priceOracle.oracleId,
    price: basePrice
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(priceTx, oracleAdmin, b);
  }

  const createSeriesTx = await TxUtils.createContractSeriesTransaction(admin, {
    native: false,
    underlyingOracleId: priceOracle.oracleId,
    onChainData: [],
    notionalPropertyId: 0,
    notionalValue: 1,
    collateralPropertyId: longProp.propertyId,
    leverage,
    expiryPeriod: longExpiry,
    series,
    inverse: true,
    fee: false
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(createSeriesTx, admin, b);
  }

  const allContracts = await ContractRegistry.getAllContracts();
  const newestContract = allContracts
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    .find((c) => Number(c.collateralPropertyId) === Number(longProp.propertyId) && Number(c.underlyingOracleId) === Number(priceOracle.oracleId));

  if (!newestContract?.id) {
    throw new Error('Unable to resolve created contract id');
  }

  console.log('[utxo-bitvm-receipt-contract-live] SUCCESS');
  console.log(JSON.stringify({
    admin,
    oracleAdmin,
    alice,
    bob,
    activated,
    stateOracleId: stateOracle.oracleId,
    priceOracleId: priceOracle.oracleId,
    shortPropertyId: shortProp.propertyId,
    longPropertyId: longProp.propertyId,
    shortGrantTxs: grants,
    rollTxA,
    rollTxB,
    redeemTx,
    priceTx,
    createSeriesTx,
    contractId: newestContract.id,
    contractTicker: newestContract.ticker,
    contractCollateralPropertyId: newestContract.collateralPropertyId,
    contractExpiryPeriod: newestContract.expiryPeriod
  }, null, 2));
}

main().catch((err) => {
  console.error('[utxo-bitvm-receipt-contract-live] failed:', err.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
