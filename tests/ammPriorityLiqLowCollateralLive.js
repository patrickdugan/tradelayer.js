/**
 * Live isolated AMM-priority liquidation check with a low-collateral account.
 *
 * Flow:
 * 1) create a fresh wallet address
 * 2) fund small LTC + small collateral token balance
 * 3) force AMM-only quotes on contract book
 * 4) open a small long against AMM
 * 5) move oracle down in capped steps and run clearing
 * 6) assert liquidation trade exists with AMM as counterparty
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Orderbook = require('../src/orderbook');
const AMMPool = require('../src/amm');
const OracleList = require('../src/oracle');
const MarginMap = require('../src/marginMap');
const TradeHistory = require('../src/tradeHistoryManager');
const Tally = require('../src/tally');
const ContractRegistry = require('../src/contractRegistry');
const ClearList = require('../src/clearlist');

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

async function setAmmOnlyQuotes(contractId, markPrice, blockHeight) {
  const amm = await ContractRegistry.getAMM(contractId);
  if (!amm) throw new Error(`No AMM instance for contract ${contractId}`);
  const quoteOrders = amm.quoteContractOrders(markPrice, blockHeight);
  const buy = quoteOrders.filter((o) => !o.sell);
  const sell = quoteOrders.filter((o) => o.sell);
  if ((buy.length + sell.length) === 0) throw new Error('AMM returned no quote orders');

  const key = String(contractId);
  const ob = await Orderbook.getOrderbookInstance(key);
  await ob.saveOrderBook({ buy, sell }, key);
  return { buy, sell };
}

async function getBestAsk(contractId) {
  const ob = new Orderbook(String(contractId));
  const data = await ob.loadOrderBook(String(contractId), false);
  const asks = Array.isArray(data?.sell) ? data.sell.slice() : [];
  asks.sort((a, b) => Number(a.price) - Number(b.price));
  return asks[0] || null;
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const collateralId = nenv('TL_COLLATERAL_ID', 5);
  const ltcFund = nenv('TL_NEW_ADDR_LTC', 0.02);
  const tokenFund = nenv('TL_NEW_ADDR_TOKEN', 5);
  const contractAmount = nenv('TL_TRADE_AMOUNT', 1);
  const maxSteps = nenv('TL_MAX_STEPS', 30);
  const maxMovePct = nenv('TL_MAX_MOVE_PCT', 0.05);
  const adverseTarget = nenv('TL_ADVERSE_TARGET', 1);
  const requireSuccess = benv('TL_REQUIRE_SUCCESS', true);
  let synthBlock = nenv('TL_SYNTH_BLOCK_START', 4561000);

  await TxUtils.init();
  await Activation.getInstance().init();
  const startBlock = await TxUtils.getBlockCount();

  const trader = await TxUtils.client.rpcCall('getnewaddress', [], true);
  const ltcTx = await TxUtils.client.rpcCall('sendtoaddress', [trader, ltcFund], true);
  const sendTokenTx = await TxUtils.sendTransaction(admin, trader, collateralId, tokenFund, 0);
  if (!sendTokenTx || String(sendTokenTx).startsWith('Error')) {
    throw new Error(`token funding send failed: ${sendTokenTx}`);
  }
  await applyTxNow(sendTokenTx, admin, startBlock);
  await ClearList.addAttestation(0, trader, 'CA', startBlock);

  const markStart = Number(await OracleList.getOraclePrice(oracleId));
  if (!Number.isFinite(markStart) || markStart <= 0) throw new Error('Invalid oracle start price');

  // Refresh AMM orderbook and keep AMM-only quotes.
  await AMMPool.updateOrdersForAllContractAMMs(startBlock);
  await setAmmOnlyQuotes(seriesId, markStart, startBlock);

  const ask = await getBestAsk(seriesId);
  if (!ask) throw new Error('No ask found for AMM-only book');

  const entryPrice = Number((Number(ask.price) * 1.01).toFixed(8));
  const tradeTx = await TxUtils.createContractOnChainTradeTransaction(trader, {
    contractId: seriesId,
    price: entryPrice,
    amount: contractAmount,
    sell: false,
    insurance: false,
    reduce: false,
    post: false,
    stop: false
  });
  await applyTxNow(tradeTx, trader, startBlock);
  await Orderbook.processQueuedOnChainOrdersForBlock(startBlock);

  const mm = await MarginMap.getInstance(seriesId);
  const pos = mm.margins.get(trader) || {};
  if (!(Number(pos.contracts || 0) > 0)) {
    throw new Error(`No long position opened for trader ${trader}`);
  }

  let cur = markStart;
  let hit = null;

  for (let i = 0; i < maxSteps; i += 1) {
    const down = Number((cur * (1 - maxMovePct)).toFixed(8));
    const next = Math.max(adverseTarget, down);
    const block = ++synthBlock;

    await setAmmOnlyQuotes(seriesId, cur, block);
    await OracleList.publishData(oracleId, next, undefined, undefined, undefined, block);
    cur = Number(await OracleList.getOraclePrice(oracleId));

    await Tally.setModFlag(false);
    await ContractRegistry.setModFlag(false);
    await Clearing.clearingFunction(block, true);

    const liqTrades = await TradeHistory.getLiquidationTradesForContractAtBlock(seriesId, block);
    const ammHits = (liqTrades || []).filter((t) => {
      const b = t?.buyerAddress;
      const s = t?.sellerAddress;
      const hasTrader = (b === trader || s === trader);
      const hasAmm = (b === 'amm' || s === 'amm');
      return hasTrader && hasAmm;
    });

    console.log('[step]', {
      step: i + 1,
      block,
      mark: cur,
      liqTrades: liqTrades.length,
      ammHits: ammHits.length
    });

    if (ammHits.length > 0) {
      hit = { block, mark: cur, trader, trades: ammHits };
      break;
    }
    if (cur <= adverseTarget) break;
  }

  if (!hit) {
    const msg = 'No liquidation with AMM counterparty observed';
    if (requireSuccess) throw new Error(msg);
    console.log('[amm-priority-low-collateral] WARN', msg);
    return;
  }

  console.log('[amm-priority-low-collateral] SUCCESS', {
    trader: hit.trader,
    block: hit.block,
    mark: hit.mark,
    trades: hit.trades.map((t) => ({
      buyerAddress: t.buyerAddress,
      sellerAddress: t.sellerAddress,
      amount: t.amount,
      price: t.price,
      liquidation: t.liquidation
    })),
    funding: {
      ltcTx,
      tokenTx: sendTokenTx,
      tradeTx
    }
  });
}

const Clearing = require('../src/clearing');

main().catch((e) => {
  console.error('[amm-priority-low-collateral] failed:', e && e.stack ? e.stack : (e.message || e));
  process.exit(1);
});
