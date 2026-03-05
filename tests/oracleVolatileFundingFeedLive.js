/**
 * Live oracle feed + funding spread telemetry for contract funding paths.
 *
 * Publishes oracle prints around live LTC/USD with bounded volatility, and logs:
 * - contract index price
 * - pair VWAP (if available)
 * - oracle price + TWAP
 * - spread hints for funding diagnostics
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

function clampMove(prev, next, maxPct) {
  if (!Number.isFinite(prev) || prev <= 0) return Number(next.toFixed(2));
  const up = prev * (1 + maxPct);
  const down = prev * (1 - maxPct);
  if (next > up) return Number(up.toFixed(2));
  if (next < down) return Number(down.toFixed(2));
  return Number(next.toFixed(2));
}

async function fetchLtcUsd() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd';
  const res = await axios.get(url, { timeout: 10000 });
  const px = Number(res?.data?.litecoin?.usd);
  if (!Number.isFinite(px) || px <= 0) throw new Error(`Invalid LTC price: ${px}`);
  return px;
}

async function telemetry(contractId, oracleId, trailingBlocks) {
  const block = await TxUtils.getBlockCount();
  const info = await ContractRegistry.getContractInfo(contractId);
  if (!info) throw new Error(`Missing contract ${contractId}`);

  const data = info.data || info;
  const notional = Number(data.notionalPropertyId || 0);
  const collateral = Number(data.collateralPropertyId || 0);
  const underlyingOracleId = Number(data.underlyingOracleId || oracleId);

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

  return {
    ts: new Date().toISOString(),
    block,
    contractId,
    oracleId,
    indexPrice,
    pairVWAP,
    oraclePx,
    oracleTwap,
    vwapSpreadBps,
    twapSpreadBps
  };
}

async function main() {
  const admin = env('TL_ADMIN_ADDRESS', 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');
  const contractId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const jitterPct = nenv('TL_VOL_JITTER_PCT', 0.04); // +/- 4%
  const maxMovePct = nenv('TL_MAX_MOVE_PCT', 0.05); // cap per publish
  const sleepMs = nenv('TL_FEED_MS', 90000);
  const trailing = nenv('TL_TRAILING_BLOCKS', 192);
  const maxTicks = nenv('TL_FEED_TICKS', 0); // 0 => run forever

  await TxUtils.init();

  let tick = 0;
  let prev = null;
  while (maxTicks <= 0 || tick < maxTicks) {
    tick += 1;
    try {
      const spot = await fetchLtcUsd();
      const noisy = spot * (1 + ((Math.random() * 2 * jitterPct) - jitterPct));
      const publishPx = clampMove(prev, noisy, maxMovePct);
      const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price: publishPx });
      prev = publishPx;

      const t = await telemetry(contractId, oracleId, trailing);
      console.log(JSON.stringify({
        tick,
        txid,
        spot,
        publishedOracle: publishPx,
        ...t
      }));
    } catch (e) {
      console.error(`[oracle-feed] tick=${tick} err=${e && e.message ? e.message : e}`);
    }
    await sleep(sleepMs);
  }
}

main().catch((e) => {
  console.error('[oracle-feed] fatal:', e && e.stack ? e.stack : (e && e.message ? e.message : e));
  process.exit(1);
});

