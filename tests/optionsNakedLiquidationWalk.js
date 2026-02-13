/**
 * Live naked-write liquidation walk.
 *
 * Env:
 * - WALLET_NAME=wallet.dat
 * - TL_ADMIN_ADDRESS=<admin addr>
 * - TL_CHANNEL_ADDRESS=<channel sender for type 27> (default admin address)
 * - TL_SERIES_ID=3
 * - TL_ORACLE_ID=2
 * - TL_START_SPOT=108
 * - TL_TARGET_SPOTS=102,97,92,87,82
 * - TL_STRIKE=120
 * - TL_AMOUNT=5
 * - TL_PRICE=0
 * - TL_MAX_STEP_PCT=0.05
 * - TL_ACTIVATE_TYPES=14,27
 * - TL_WAIT_BLOCKS=0
 */

const TxUtils = require('../src/txUtils');
const Clearing = require('../src/clearing');
const Tally = require('../src/tally');
const Channels = require('../src/channels');
const ContractRegistry = require('../src/contractRegistry');
const MarginMap = require('../src/marginMap');

function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function splitNums(name, fallbackCsv) {
  const raw = process.env[name] || fallbackCsv;
  return String(raw).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
}

function cappedMove(fromPrice, toPrice, maxMovePct) {
  const up = fromPrice * (1 + maxMovePct);
  const down = fromPrice * (1 - maxMovePct);
  if (toPrice > up) return Number(up.toFixed(4));
  if (toPrice < down) return Number(down.toFixed(4));
  return Number(toPrice.toFixed(4));
}

async function waitBlocks(delta) {
  if (!delta || delta <= 0) return;
  const start = await TxUtils.getBlockCount();
  const target = start + delta;
  const timeoutMs = 15 * 60 * 1000;
  const begun = Date.now();
  while (Date.now() - begun < timeoutMs) {
    const cur = await TxUtils.getBlockCount();
    if (cur >= target) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for +${delta} blocks`);
}

async function reportCoverage(seriesId, writerAddress, spot, block) {
  const clearing = new Clearing();
  const optionAdj = await clearing.computeOptionAdjustments(seriesId, writerAddress, spot, block, 144);
  const contractInfo = await ContractRegistry.getContractInfo(Number(seriesId));
  const collateralId = Number(contractInfo?.collateralPropertyId);
  const tally = await Tally.getTally(writerAddress, collateralId);
  const cov = Clearing.computeLossCoverage(
    tally?.available || 0,
    tally?.margin || 0,
    optionAdj
  );
  const mm = await MarginMap.getInstance(seriesId);
  const pos = mm.margins.get(writerAddress) || {};
  const optionCount = Object.keys(pos.options || {}).length;
  return {
    collateralId,
    available: tally?.available || 0,
    margin: tally?.margin || 0,
    optionAdj,
    coverage: cov.coverage.toNumber(),
    optionCount
  };
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const startSpot = nenv('TL_START_SPOT', 108);
  const targets = splitNums('TL_TARGET_SPOTS', '102,97,92,87,82');
  const strike = nenv('TL_STRIKE', 120);
  const amount = nenv('TL_AMOUNT', 5);
  const price = nenv('TL_PRICE', 0);
  const maxStep = nenv('TL_MAX_STEP_PCT', 0.05);
  const waitDelta = nenv('TL_WAIT_BLOCKS', 0);
  const activateTypes = splitNums('TL_ACTIVATE_TYPES', '14,27');

  await TxUtils.init();
  let block = await TxUtils.getBlockCount();

  console.log('--- options naked liquidation walk ---');
  console.log({ admin, channel, seriesId, oracleId, startSpot, targets, strike, amount, price, maxStep, waitDelta });

  for (const t of activateTypes) {
    const txid = await TxUtils.activationTransaction(admin, t);
    console.log(`[activate] type=${t} txid=${txid}`);
  }
  await waitBlocks(waitDelta);

  const expiry = block + 120;
  const ticker = `${seriesId}-${expiry}-C-${strike}`;

  // seller = B side by setting columnAIsSeller=false (works for self-channel in current test setup)
  const optionTxid = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: ticker,
    price,
    amount,
    columnAIsSeller: false,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  console.log(`[option] txid=${optionTxid} ticker=${ticker}`);
  await waitBlocks(waitDelta);

  const commits = await Channels.getCommitAddresses(channel);
  const writerAddress = commits.commitAddressB || channel;
  console.log(`[writer] ${writerAddress}`);

  let cur = startSpot;
  for (const target of targets) {
    while (cur !== target) {
      const next = cappedMove(cur, target, maxStep);
      const oracleTxid = await TxUtils.publishDataTransaction(admin, {
        oracleid: oracleId,
        price: next
      });
      console.log(`[oracle] ${cur} -> ${next} txid=${oracleTxid}`);
      cur = next;

      await waitBlocks(waitDelta);
      block = await TxUtils.getBlockCount();
      await Clearing.clearingFunction(block, true);

      const rep = await reportCoverage(seriesId, writerAddress, cur, block);
      const liq = Clearing.getLiquidation(seriesId, writerAddress);
      console.log('[step]', {
        block,
        spot: cur,
        coverage: rep.coverage,
        optionCount: rep.optionCount,
        maintNaked: rep.optionAdj.maintNaked,
        premiumMTM: rep.optionAdj.premiumMTM,
        liquidation: liq || null
      });
      if (rep.optionCount === 0) {
        console.log('[warn] writer option leg not indexed yet; increase TL_WAIT_BLOCKS to wait for block ingestion');
      }
    }
  }

  console.log('--- walk complete ---');
}

main().catch((e) => {
  console.error('optionsNakedLiquidationWalk failed:', e.message || e);
  process.exit(1);
});
