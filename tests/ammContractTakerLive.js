/**
 * Live AMM maker + taker integration harness.
 *
 * Flow:
 * 1) ensure AMM has contract liquidity (type 10 add)
 * 2) publish oracle mark
 * 3) inject AMM quotes into orderbook
 * 4) send on-chain taker contract trade (type 18)
 * 5) process queued on-chain orders for the block
 * 6) verify tracked position changed
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const AMMPool = require('../src/amm');
const Orderbook = require('../src/orderbook');
const MarginMap = require('../src/marginMap');
const OracleList = require('../src/oracle');
const ContractRegistry = require('../src/contractRegistry');

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
  if (decoded.valid !== true) throw new Error(`invalid tx ${txid}: ${decoded.reason || 'unknown'}`);
  await Logic.typeSwitch(parsed.type, decoded);
}

async function ensureAmmLiquidity(admin, seriesId, addAmount, block) {
  const info = await ContractRegistry.getContractInfo(seriesId);
  const curPos = Number(info?.ammPool?.position || 0);
  const maxPos = Number(info?.ammPool?.maxPosition || 0);
  if (curPos >= addAmount || (maxPos > 0 && curPos >= maxPos)) {
    return null;
  }
  const addTx = await TxUtils.createAMMPoolTransaction(admin, {
    isRedeem: 0,
    isContract: 1,
    id: seriesId,
    amount: addAmount,
    id2: 0,
    amount2: 0
  });
  await applyTxNow(addTx, admin, block);
  return addTx;
}

async function publishOracle(admin, oracleId, price, blockHeight) {
  const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price });
  await applyTxNow(txid, admin, blockHeight);
  return txid;
}

async function getBestAsk(contractId) {
  const ob = new Orderbook(String(contractId));
  const data = await ob.loadOrderBook(String(contractId), false);
  const asks = Array.isArray(data?.sell) ? data.sell.slice() : [];
  asks.sort((a, b) => Number(a.price) - Number(b.price));
  return asks[0] || null;
}

async function getPosition(contractId, address) {
  const mm = await MarginMap.getInstance(contractId);
  const pos = mm.margins.get(address) || {};
  return Number(pos.contracts || 0);
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const oraclePx = nenv('TL_ORACLE_PX', 110);
  const addAmount = nenv('TL_AMM_ADD_AMOUNT', 1);
  const takerAmount = nenv('TL_TAKER_AMOUNT', 1);
  const takerBuy = benv('TL_TAKER_BUY', true);
  const activate10 = benv('TL_ACTIVATE_AMM_TX', false);
  const activate18 = benv('TL_ACTIVATE_TRADE_TX', false);

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();

  console.log('[amm-taker-live] config', {
    admin,
    seriesId,
    oracleId,
    oraclePx,
    addAmount,
    takerAmount,
    takerBuy,
    block
  });

  if (activate10) {
    const act10 = await TxUtils.activationTransaction(admin, 10);
    await applyTxNow(act10, admin, block);
  }
  if (activate18) {
    const act18 = await TxUtils.activationTransaction(admin, 18);
    await applyTxNow(act18, admin, block);
  }

  const addTx = await ensureAmmLiquidity(admin, seriesId, addAmount, block);
  console.log('[amm-taker-live] add tx', addTx);

  const oracleTx = await publishOracle(admin, oracleId, oraclePx, block);
  console.log('[amm-taker-live] oracle tx', oracleTx);

  await AMMPool.updateOrdersForAllContractAMMs(block);
  const ask = await getBestAsk(seriesId);
  if (!ask) throw new Error('No AMM ask present after quote injection');
  console.log('[amm-taker-live] best ask', ask);

  const beforeContracts = await getPosition(seriesId, admin);

  const takerPrice = takerBuy
    ? Number((Number(ask.price) * 1.01).toFixed(8))
    : Number((Number(ask.price) * 0.99).toFixed(8));

  const takerTx = await TxUtils.createContractOnChainTradeTransaction(admin, {
    contractId: seriesId,
    price: takerPrice,
    amount: takerAmount,
    sell: !takerBuy,
    insurance: false,
    reduce: false,
    post: false,
    stop: false
  });
  await applyTxNow(takerTx, admin, block);
  console.log('[amm-taker-live] taker tx queued', takerTx);

  await Orderbook.processQueuedOnChainOrdersForBlock(block);
  const afterContracts = await getPosition(seriesId, admin);

  console.log('[amm-taker-live] contracts', { beforeContracts, afterContracts });
  if (afterContracts === beforeContracts) {
    throw new Error('Taker trade did not change position (no AMM fill observed)');
  }

  const mark = await OracleList.getOraclePrice(oracleId);
  console.log('[amm-taker-live] SUCCESS', { mark });
}

main().catch((e) => {
  console.error('[amm-taker-live] failed:', e.message || e);
  process.exit(1);
});
