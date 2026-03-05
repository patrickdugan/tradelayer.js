/**
 * Combined live stress harness:
 * - fires frequent contract trades (type-18) across a trader set
 * - publishes volatile oracle prints from live LTC/USD
 * - logs index/VWAP/TWAP spread telemetry for funding diagnostics
 *
 * Run with wallet-scoped RPC env (`WALLET_NAME` / `RPC_WALLET`) on LTCTEST.
 */

const axios = require('axios');
const TxUtils = require('../src/txUtils');
const VolumeIndex = require('../src/volumeIndex');
const ContractRegistry = require('../src/contractRegistry');
const OracleList = require('../src/oracle');
const Clearing = require('../src/clearing');

function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function env(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampMove(prev, next, maxPct) {
  if (!Number.isFinite(prev) || prev <= 0) return Number(next.toFixed(2));
  const up = prev * (1 + maxPct);
  const down = prev * (1 - maxPct);
  if (next > up) return Number(up.toFixed(2));
  if (next < down) return Number(down.toFixed(2));
  return Number(next.toFixed(2));
}

async function fetchLtcUsd() {
  const res = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd',
    { timeout: 10000 }
  );
  const px = Number(res?.data?.litecoin?.usd);
  if (!Number.isFinite(px) || px <= 0) throw new Error(`Invalid LTC price: ${px}`);
  return px;
}

async function publishOracleWithTelemetry(ctx) {
  const { admin, oracleId, contractId, jitterPct, maxMovePct, trailingBlocks } = ctx;

  const spot = await fetchLtcUsd();
  const noisy = spot * (1 + ((Math.random() * 2 * jitterPct) - jitterPct));
  const publishPx = clampMove(ctx.prevOraclePx, noisy, maxMovePct);
  const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price: publishPx });
  ctx.prevOraclePx = publishPx;

  const block = await TxUtils.getBlockCount();
  const cInfoRaw = await ContractRegistry.getContractInfo(contractId);
  const cInfo = cInfoRaw?.data || cInfoRaw || {};
  const notional = Number(cInfo.notionalPropertyId || 0);
  const collateral = Number(cInfo.collateralPropertyId || 0);
  const underlyingOracleId = Number(cInfo.underlyingOracleId || oracleId);

  let pairVWAP = null;
  if (notional >= 0 && collateral > 0) {
    pairVWAP = await VolumeIndex.getVWAP(notional, collateral, block, trailingBlocks);
  }
  const oraclePx = await OracleList.getOraclePrice(oracleId);
  const oracleTwap = await OracleList.getTWAP(underlyingOracleId, block, trailingBlocks);
  const indexPrice = await Clearing.getIndexPrice(contractId, block);

  const vwapSpreadBps = (pairVWAP && indexPrice)
    ? Number((((indexPrice - pairVWAP) / pairVWAP) * 10000).toFixed(2))
    : null;
  const twapSpreadBps = (oracleTwap && indexPrice)
    ? Number((((indexPrice - oracleTwap) / oracleTwap) * 10000).toFixed(2))
    : null;

  console.log(JSON.stringify({
    type: 'oracle',
    ts: new Date().toISOString(),
    txid,
    block,
    contractId,
    oracleId,
    spot,
    publishedOracle: publishPx,
    indexPrice,
    pairVWAP,
    oraclePx,
    oracleTwap,
    vwapSpreadBps,
    twapSpreadBps
  }));
}

async function submitTrade(ctx) {
  const traderPool = Array.isArray(ctx.activeTraders) && ctx.activeTraders.length > 0
    ? ctx.activeTraders
    : ctx.traders;
  const trader = traderPool[randInt(0, traderPool.length - 1)];
  const sideBuy = Math.random() < 0.5;
  const tradeParams = {
    contractId: ctx.contractId,
    sell: sideBuy ? 0 : 1,
    amount: randInt(ctx.minContracts, ctx.maxContracts),
    price: Number((ctx.basePrice + ((Math.random() * 2 - 1) * ctx.priceSpread)).toFixed(2))
  };
  const txid = await TxUtils.createContractOnChainTradeTransaction(trader, tradeParams);
  console.log(JSON.stringify({
    type: 'trade',
    ts: new Date().toISOString(),
    trader,
    side: sideBuy ? 'BUY' : 'SELL',
    txid,
    ...tradeParams
  }));
}

async function refreshSpendableTraders(ctx) {
  const minLtc = Number(ctx.minSpendableLtc || 0.00005);
  const good = [];
  for (const address of ctx.traders) {
    try {
      const utxos = await TxUtils.client.rpcCall('listunspent', [0, 9999999, [address]], true);
      const spendable = (utxos || []).some((u) => Number(u.amount || 0) >= minLtc && u.spendable !== false);
      if (spendable) good.push(address);
    } catch (_) {
      // keep address out of active set if probe fails
    }
  }
  if (good.length > 0) ctx.activeTraders = good;
  return ctx.activeTraders || [];
}

async function main() {
  const admin = env('TL_ADMIN_ADDRESS', 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');
  const contractId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);

  const traders = env(
    'TL_TRADER_ADDRESSES',
    'tltc1qzq5fruejqg844ulcqc4lfcdwwvfpnf3vf9l73y,tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6,tltc1q600749ge73rqmef52drmemsgvrk4797e2a7m0u,tltc1qnx2cm5dfyhravee74tv6kk45lcyp3ll4eu5g7d'
  ).split(',').map((s) => s.trim()).filter(Boolean);
  if (traders.length === 0) throw new Error('No trader addresses configured');

  const ctx = {
    admin,
    oracleId,
    contractId,
    traders,
    minContracts: nenv('TL_MIN_CONTRACTS', 1),
    maxContracts: nenv('TL_MAX_CONTRACTS', 5),
    basePrice: nenv('TL_BASE_PRICE', 106),
    priceSpread: nenv('TL_PRICE_SPREAD', 12),
    tradeDelayMinMs: nenv('TL_TRADE_DELAY_MIN_MS', 3000),
    tradeDelayMaxMs: nenv('TL_TRADE_DELAY_MAX_MS', 8000),
    oracleEveryTicks: nenv('TL_ORACLE_EVERY_TICKS', 4),
    jitterPct: nenv('TL_VOL_JITTER_PCT', 0.04),
    maxMovePct: nenv('TL_MAX_MOVE_PCT', 0.05),
    trailingBlocks: nenv('TL_TRAILING_BLOCKS', 192),
    minSpendableLtc: nenv('TL_MIN_SPENDABLE_LTC', 0.00005),
    maxTicks: nenv('TL_MAX_TICKS', 0),
    prevOraclePx: null
  };

  await TxUtils.init();
  await refreshSpendableTraders(ctx);
  console.log(JSON.stringify({
    type: 'start',
    ts: new Date().toISOString(),
    admin: ctx.admin,
    contractId: ctx.contractId,
    oracleId: ctx.oracleId,
    traders: ctx.traders.length,
    activeTraders: (ctx.activeTraders || []).length
  }));

  let tick = 0;
  while (ctx.maxTicks <= 0 || tick < ctx.maxTicks) {
    tick += 1;
    if (tick % 20 === 1) {
      await refreshSpendableTraders(ctx);
    }
    try {
      await submitTrade(ctx);
    } catch (e) {
      console.error(`[trade] tick=${tick} err=${e && e.message ? e.message : e}`);
    }

    if (tick % ctx.oracleEveryTicks === 0) {
      try {
        await publishOracleWithTelemetry(ctx);
      } catch (e) {
        console.error(`[oracle] tick=${tick} err=${e && e.message ? e.message : e}`);
      }
    }

    const delay = randInt(ctx.tradeDelayMinMs, ctx.tradeDelayMaxMs);
    await sleep(delay);
  }
}

main().catch((e) => {
  console.error('[spam-oracle-vwap] fatal:', e && e.stack ? e.stack : (e && e.message ? e.message : e));
  process.exit(1);
});
