const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Encode = require('../src/txEncoder');
const OracleList = require('../src/oracle');
const PropertyList = require('../src/property');
const ContractRegistry = require('../src/contractRegistry');
const TallyMap = require('../src/tally');
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
  const utxo = await selectFundingUtxo(senderAddress);
  if (!utxo) {
    throw new Error(`No spendable UTXO found for ${senderAddress}`);
  }
  const privateKey = await TxUtils.client.dumpprivkey(senderAddress);
  const tx = new litecore.Transaction()
    .from(utxo)
    .addData(payload)
    .change(senderAddress)
    .fee(2000);
  tx.sign(privateKey);
  return TxUtils.client.sendrawtransaction(tx.serialize());
}

async function selectFundingUtxo(address) {
  const utxos = await TxUtils.client.listUnspent(0, 9999999, [address]);
  const raw = (utxos || [])
    .filter((u) => Number(u?.amount || 0) > 0)
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  if (!raw) return null;
  return {
    txId: raw.txid,
    outputIndex: raw.vout,
    address: raw.address,
    script: raw.scriptPubKey,
    satoshis: Math.round(Number(raw.amount || 0) * 1e8)
  };
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
  const props = await PropertyList.getPropertyIndex();
  const existing = props.find((p) => p.ticker === ticker);
  if (existing?.id) {
    return { txid: null, propertyId: Number(existing.id), ticker, reused: true };
  }

  try {
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
    const refreshed = await PropertyList.getPropertyIndex();
    const prop = refreshed.find((p) => p.ticker === ticker);
    if (!prop?.id) throw new Error(`Unable to resolve property id for ${ticker}`);
    return { txid: issueTx, propertyId: Number(prop.id), ticker, reused: false };
  } catch (err) {
    const reason = String(err?.message || err || '');
    if (!/already exists|undefinedTicker/i.test(reason)) {
      throw err;
    }

    const fallbackTicker = `BVM${Date.now().toString().slice(-3)}`.slice(0, 6);
    const fallbackIssueTx = await broadcastPayload(admin, Encode.encodeTokenIssue({
      initialAmount: 1,
      ticker: fallbackTicker,
      whitelists: [],
      managed: true,
      backupAddress: '',
      nft: false,
      coloredCoinHybrid: false,
      proceduralType
    }));
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(fallbackIssueTx, admin, b);
    }
    const refreshed = await PropertyList.getPropertyIndex();
    const prop = refreshed.find((p) => p.ticker === fallbackTicker);
    if (!prop?.id) throw new Error(`Unable to resolve property id for ${fallbackTicker}`);
    console.log('[utxo-bitvm-short-epoch-router-live] ticker-fallback', JSON.stringify({
      requestedTicker: ticker,
      fallbackTicker
    }));
    return { txid: fallbackIssueTx, propertyId: Number(prop.id), ticker: fallbackTicker, reused: false };
  }
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

async function grantManaged(admin, propertyId, amount, address, templateId, contractRef, applyImmediate) {
  const grantFeeSats = 2000;
  const grantSlackSats = Number(process.env.TL_GRANT_SLACK_SATS || 5000);
  const utxos = await TxUtils.client.listUnspent(0, 9999999, [admin]);
  const rawGrantUtxo = (utxos || [])
    .filter((u) => Number(u?.amount || 0) > 0)
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
  if (!rawGrantUtxo) {
    throw new Error(`No spendable UTXO found for grant sender ${admin}`);
  }
  const grantUtxo = {
    txId: rawGrantUtxo.txid,
    outputIndex: rawGrantUtxo.vout,
    address: rawGrantUtxo.address,
    script: rawGrantUtxo.scriptPubKey,
    satoshis: Math.round(Number(rawGrantUtxo.amount || 0) * 1e8)
  };
  const maxGrantSats = Math.max(0, Number(grantUtxo?.satoshis || 0) - grantFeeSats - grantSlackSats);
  const requestedGrantSats = Math.max(0, Math.round(Number(amount || 0) * 1e8));
  const grantSats = maxGrantSats;
  if (grantSats <= 0) {
    throw new Error(`Unable to size procedural grant for ${address}: utxo=${grantUtxo?.satoshis || 0} fee=${grantFeeSats} slack=${grantSlackSats}`);
  }
  const txid = await TxUtils.createGrantManagedTokenTransaction(admin, {
    propertyId,
    amountGranted: grantSats / 1e8,
    addressToGrantTo: address,
    dlcTemplateId: templateId,
    dlcContractId: contractRef,
    settlementState: 'FUNDED',
    dlcHash: `${templateId}-hash`,
    fundingUtxo: grantUtxo
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(txid, admin, b);
  }
  console.log('[utxo-bitvm-short-epoch-router-live] grant-sized', JSON.stringify({
    admin,
    propertyId,
    requestedAmount: amount,
    grantSats,
    grantAmount: grantSats / 1e8,
    selectedUtxoSats: grantUtxo?.satoshis || 0,
    slackSats: grantSlackSats
  }));
  return txid;
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

  const fundingUtxo = await selectFundingUtxo(oracleAdmin);
  if (!fundingUtxo) {
    throw new Error(`No spendable UTXO found for relay sender ${oracleAdmin}`);
  }
  const txid = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: params.oracleId,
    relayType: 1,
    stateHash: settlement.stateHash,
    dlcRef: params.dlcRef,
    settlementState: settlement.settlementState || 'SETTLED',
    fundingUtxo,
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

async function publishPrice(oracleAdmin, oracleId, price, applyImmediate) {
  const fundingUtxo = await selectFundingUtxo(oracleAdmin);
  if (!fundingUtxo) {
    throw new Error(`No spendable UTXO found for price sender ${oracleAdmin}`);
  }
  const txid = await TxUtils.publishDataTransaction(oracleAdmin, {
    oracleid: oracleId,
    price,
    fundingUtxo
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(txid, oracleAdmin, b);
  }
  return txid;
}

function floor8(value) {
  return Math.floor((Number(value) + Number.EPSILON) * 1e8) / 1e8;
}

function computeRouterPlan({
  collateralAmount,
  realizedLossBps,
  adapterPathCount,
  winners
}) {
  const normalizedWinners = (winners || []).filter((w) => w && w.address && Number(w.weightBps || 0) > 0);
  if (normalizedWinners.length === 0) {
    throw new Error('At least one weighted winner is required');
  }
  const weightTotal = normalizedWinners.reduce((sum, w) => sum + Number(w.weightBps || 0), 0);
  const stepBps = Math.max(1, Math.floor(10000 / Math.max(1, Number(adapterPathCount || 1))));
  const clippedLossBps = Math.max(0, Math.min(10000, Math.floor(Number(realizedLossBps || 0))));
  const bucketLossBps = Math.floor(clippedLossBps / stepBps) * stepBps;
  const excessLossBps = clippedLossBps - bucketLossBps;
  const totalLossAmount = floor8(Number(collateralAmount) * clippedLossBps / 10000);
  const bucketLossAmount = floor8(Number(collateralAmount) * bucketLossBps / 10000);
  const excessLossAmount = floor8(totalLossAmount - bucketLossAmount);
  const refundRemainderAmount = floor8(Number(collateralAmount) - totalLossAmount);

  let distributed = 0;
  const winnerExcess = normalizedWinners.map((winner, idx) => {
    let amount;
    if (idx === normalizedWinners.length - 1) {
      amount = floor8(excessLossAmount - distributed);
    } else {
      amount = floor8(excessLossAmount * Number(winner.weightBps || 0) / weightTotal);
      distributed = floor8(distributed + amount);
    }
    return {
      address: winner.address,
      weightBps: Number(winner.weightBps || 0),
      amount
    };
  }).filter((w) => w.amount > 0);

  return {
    collateralAmount: floor8(collateralAmount),
    realizedLossBps: clippedLossBps,
    adapterPathCount,
    stepBps,
    bucketLossBps,
    excessLossBps,
    totalLossAmount,
    bucketLossAmount,
    excessLossAmount,
    refundRemainderAmount,
    winnerExcess
  };
}

async function tally(address, propertyId) {
  const row = await TallyMap.getTally(address, propertyId);
  return {
    amount: Number(row?.amount || 0),
    available: Number(row?.available || 0),
    reserved: Number(row?.reserved || 0),
    margin: Number(row?.margin || 0),
    vesting: Number(row?.vesting || 0)
  };
}

async function main() {
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const admin = env('TL_ADMIN_ADDRESS');
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS', admin);
  const alice = env('TL_ALICE_ADDRESS');
  const bob = env('TL_BOB_ADDRESS');
  const charlie = env('TL_CHARLIE_ADDRESS');
  const depositAlice = nenv('TL_DEPOSIT_ALICE', 0.004);
  const depositBob = nenv('TL_DEPOSIT_BOB', 0.004);
  const depositCharlie = nenv('TL_DEPOSIT_CHARLIE', 0.004);
  const entryPrice = nenv('TL_ENTRY_PRICE', 106);
  const exitPrice = nenv('TL_EXIT_PRICE', 112);
  const leverage = nenv('TL_LEVERAGE', 10);
  const expiryBlocks = nenv('TL_EXPIRY_BLOCKS', 24);
  const adapterPathCount = nenv('TL_ADAPTER_PATH_COUNT', 20);
  const realizedLossBps = nenv('TL_REALIZED_LOSS_BPS', 3700);
  const shortTicker = env('TL_SHORT_TICKER', `BVM${Date.now().toString().slice(-3)}`);
  const stateOracleTicker = env('TL_STATE_ORACLE_TICKER', 'BITVMSTATE');
  const priceOracleTicker = env('TL_PRICE_ORACLE_TICKER', 'LTCUSD');
  const templateId = env('TL_TEMPLATE_ID', `tpl-short-router-${Date.now()}`);
  const contractRef = env('TL_SHORT_CONTRACT_REF', `bitvm-short-${Date.now()}`);
  const cacheDelayBlocks = nenv('TL_BITVM_CACHE_DELAY_BLOCKS', 0);

  if (!admin || !oracleAdmin || !alice || !bob || !charlie) {
    throw new Error('Missing TL_ADMIN_ADDRESS / TL_ORACLE_ADMIN_ADDRESS / TL_ALICE_ADDRESS / TL_BOB_ADDRESS / TL_CHARLIE_ADDRESS');
  }

  await TxUtils.init();
  const activation = Activation.getInstance();
  await activation.init();
  const chain = await TxUtils.client.getBlockchainInfo();
  if (chain.chain !== 'test') throw new Error(`Expected testnet, got ${chain.chain}`);

  const activated = [];
  for (const txType of [1, 11, 13, 14, 16, 30]) {
    activated.push({ txType, txid: await activateIfNeeded(admin, txType, applyImmediate) });
  }

  const stateOracle = await createOracle(oracleAdmin, stateOracleTicker, applyImmediate);
  const priceOracle = await createOracle(oracleAdmin, priceOracleTicker, applyImmediate);
  const shortProp = await issueManagedProperty(admin, shortTicker, applyImmediate, 1);

  await ProceduralRegistry.upsertTemplate(templateId, {
    oracleId: stateOracle.oracleId,
    collateralPropertyId: shortProp.propertyId,
    receiptPropertyId: shortProp.propertyId,
    templateHash: `${templateId}-hash`
  });
  await ProceduralRegistry.upsertContract(contractRef, templateId, 'FUNDED', { epoch: 1, mode: 'short-router' });

  const grants = [
    { address: bob, amount: depositBob, label: 'primary-bob-collateral' }
  ];
  for (const grant of grants) {
    grant.txid = await grantManaged(admin, shortProp.propertyId, grant.amount, grant.address, templateId, contractRef, applyImmediate);
  }

  const entryPriceTx = await publishPrice(oracleAdmin, priceOracle.oracleId, entryPrice, applyImmediate);
  const seriesFundingUtxo = await selectFundingUtxo(admin);
  if (!seriesFundingUtxo) {
    throw new Error(`No spendable UTXO found for contract series sender ${admin}`);
  }
  const createSeriesTx = await TxUtils.createContractSeriesTransaction(admin, {
    native: false,
    underlyingOracleId: priceOracle.oracleId,
    onChainData: [],
    notionalPropertyId: 0,
    notionalValue: 1,
    collateralPropertyId: shortProp.propertyId,
    leverage,
    expiryPeriod: expiryBlocks,
    series: 1,
    inverse: true,
    fee: false,
    fundingUtxo: seriesFundingUtxo
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(createSeriesTx, admin, b);
  }

  const allContracts = await ContractRegistry.getAllContracts();
  const newestContract = allContracts
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    .find((c) => Number(c.collateralPropertyId) === Number(shortProp.propertyId) && Number(c.underlyingOracleId) === Number(priceOracle.oracleId));
  if (!newestContract?.id) {
    throw new Error('Unable to resolve created short-epoch contract id');
  }

  const exitPriceTx = await publishPrice(oracleAdmin, priceOracle.oracleId, exitPrice, applyImmediate);
  const routerPlan = computeRouterPlan({
    collateralAmount: depositBob,
    realizedLossBps,
    adapterPathCount,
    winners: [
      { address: alice, weightBps: 7000 },
      { address: charlie, weightBps: 3000 }
    ]
  });

  const signer = createOracleSigner();
  const block = await TxUtils.getBlockCount();
  const effectivePayoutBlock = block + Math.max(1, cacheDelayBlocks);

  let bucketSweepTx = null;
  if (routerPlan.bucketLossAmount > 0) {
    bucketSweepTx = await relaySettlement(oracleAdmin, {
      oracleId: stateOracle.oracleId,
      dlcRef: contractRef
    }, {
      eventId: `${contractRef}-bucket-sweep`,
      stateHash: `${contractRef}-bucket-sweep`,
      settlementState: 'SETTLED',
      payload: {
        mode: 'pnl_sweep',
        propertyId: shortProp.propertyId,
        amount: routerPlan.bucketLossAmount,
        fromAddress: bob,
        toAddress: alice
      }
    }, signer, applyImmediate);
  }

  const excessRoutes = [];
  for (let idx = 0; idx < routerPlan.winnerExcess.length; idx++) {
    const share = routerPlan.winnerExcess[idx];
    const cacheId = `${contractRef}-excess-${idx + 1}`;
    const cacheAddress = `BITVM_CACHE::${cacheId}`;

    const cacheTx = await relaySettlement(oracleAdmin, {
      oracleId: stateOracle.oracleId,
      dlcRef: contractRef
    }, {
      eventId: `${cacheId}-lock`,
      stateHash: `${cacheId}-lock`,
      settlementState: 'SETTLED',
      payload: {
        mode: 'bitvm_cache',
        cacheId,
        propertyId: shortProp.propertyId,
        amount: share.amount,
        fromAddress: bob,
        toAddress: share.address,
        cacheAddress,
        challengeBlocks: cacheDelayBlocks
      }
    }, signer, applyImmediate);

    const payoutTx = await relaySettlement(oracleAdmin, {
      oracleId: stateOracle.oracleId,
      dlcRef: contractRef
    }, {
      eventId: `${cacheId}-payout`,
      stateHash: `${cacheId}-payout`,
      settlementState: 'SETTLED',
      payload: {
        mode: 'bitvm_payout',
        cacheId,
        propertyId: shortProp.propertyId,
        amount: share.amount,
        toAddress: share.address
      }
    }, signer, false);

    if (applyImmediate) {
      await applyTxNow(payoutTx, oracleAdmin, effectivePayoutBlock);
    }

    excessRoutes.push({
      ...share,
      cacheId,
      cacheAddress,
      cacheTx,
      payoutTx
    });
  }

  const balances = {
    alice: await tally(alice, shortProp.propertyId),
    bob: await tally(bob, shortProp.propertyId),
    charlie: await tally(charlie, shortProp.propertyId)
  };

  console.log('[utxo-bitvm-short-epoch-router-live] SUCCESS');
  console.log('[utxo-bitvm-short-epoch-router-live] summary ' + JSON.stringify({
    stateOracleId: stateOracle.oracleId,
    priceOracleId: priceOracle.oracleId,
    shortPropertyId: shortProp.propertyId,
    entryPriceTx,
    exitPriceTx,
    createSeriesTx,
    contractId: newestContract.id,
    contractTicker: newestContract.ticker,
    contractExpiryPeriod: newestContract.expiryPeriod,
    routerPlan,
    bucketSweepTx,
    excessRouteCount: excessRoutes.length
  }));
  console.log(JSON.stringify({
    admin,
    oracleAdmin,
    alice,
    bob,
    charlie,
    activated,
    stateOracleId: stateOracle.oracleId,
    priceOracleId: priceOracle.oracleId,
    shortPropertyId: shortProp.propertyId,
    entryPriceTx,
    exitPriceTx,
    createSeriesTx,
    contractId: newestContract.id,
    contractTicker: newestContract.ticker,
    contractExpiryPeriod: newestContract.expiryPeriod,
    grants,
    routerPlan,
    bucketSweepTx,
    excessRoutes,
    balances
  }, null, 2));
}

main().catch((err) => {
  console.error('[utxo-bitvm-short-epoch-router-live] failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
