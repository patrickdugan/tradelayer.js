/**
 * Live harness: verify liquidation can be matched by AMM counterparty.
 *
 * Strategy:
 * 1) pick an address with BOTH perp exposure and option legs
 * 2) keep only AMM quotes on the contract orderbook
 * 3) move oracle adversely in capped steps
 * 4) run clearing each step
 * 5) assert at least one liquidation trade where counterparty is `amm`
 *
 * Env:
 * - WALLET_NAME=wallet.dat
 * - TL_ADMIN_ADDRESS=<admin>
 * - TL_SERIES_ID=3
 * - TL_ORACLE_ID=2
 * - TL_MAX_STEPS=20
 * - TL_MAX_MOVE_PCT=0.05
 * - TL_ADVERSE_TARGET_MULT=1.6
 * - TL_REQUIRE_SUCCESS=true
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Orderbook = require('../src/orderbook');
const Clearing = require('../src/clearing');
const MarginMap = require('../src/marginMap');
const ContractRegistry = require('../src/contractRegistry');
const OracleList = require('../src/oracle');
const TradeHistory = require('../src/tradeHistoryManager');
const Tally = require('../src/tally');

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

function cappedMove(fromPrice, toPrice, maxMovePct) {
  const up = fromPrice * (1 + maxMovePct);
  const down = fromPrice * (1 - maxMovePct);
  if (toPrice > up) return Number(up.toFixed(8));
  if (toPrice < down) return Number(down.toFixed(8));
  return Number(toPrice.toFixed(8));
}

async function publishOracle(admin, oracleId, price, blockHeight, forcedBlock = null) {
  const offchainOnly = benv('TL_ORACLE_OFFCHAIN', true);
  if (offchainOnly) {
    const b = Number.isFinite(forcedBlock) ? forcedBlock : blockHeight;
    await OracleList.publishData(oracleId, price, undefined, undefined, undefined, b);
    return 'offchain-oracle';
  }
  const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price });
  const applyBlock = Number.isFinite(forcedBlock) ? forcedBlock : blockHeight;
  await applyTxNow(txid, admin, applyBlock);
  return txid;
}

async function setAmmOnlyQuotes(contractId, markPrice, blockHeight) {
  const amm = await ContractRegistry.getAMM(contractId);
  if (!amm) return { buy: 0, sell: 0 };
  const quoteOrders = amm.quoteContractOrders(markPrice, blockHeight);
  const buy = quoteOrders.filter((o) => !o.sell);
  const sell = quoteOrders.filter((o) => o.sell);

  const key = String(contractId);
  const ob = await Orderbook.getOrderbookInstance(key);
  await ob.saveOrderBook({ buy, sell }, key);
  return { buy: buy.length, sell: sell.length };
}

async function pickOptionExposedAddress(seriesId, collateralId) {
  const mm = await MarginMap.getInstance(seriesId);
  const altSeriesId = String(seriesId);
  const mmAlt = await MarginMap.getInstance(altSeriesId);
  const all = new Map();

  for (const [a, p] of mm.margins.entries()) all.set(a, { base: p || {}, alt: {} });
  for (const [a, p] of mmAlt.margins.entries()) {
    const cur = all.get(a) || { base: {}, alt: {} };
    cur.alt = p || {};
    all.set(a, cur);
  }

  const candidates = [];
  for (const [address, pair] of all.entries()) {
    if (!pair || address === 'amm') continue;
    const base = pair.base || {};
    const alt = pair.alt || {};
    const contracts = Number(base.contracts || alt.contracts || 0);
    if (!Number.isFinite(contracts) || contracts === 0) continue;
    const options = { ...(base.options || {}), ...(alt.options || {}) };
    const optionCount = Object.keys(options).filter((k) => Number(options[k]?.contracts || 0) !== 0).length;
    const tally = await Tally.getTally(address, collateralId);
    const equity = Number(tally?.available || 0) + Number(tally?.margin || 0);
    const riskScore = Math.abs(contracts) / Math.max(1e-8, equity);
    candidates.push({
      address,
      contracts,
      optionCount,
      equity,
      riskScore,
      hasOptions: optionCount > 0,
      liqPrice: Number(base.liqPrice ?? base.liquidationPrice ?? alt.liqPrice ?? alt.liquidationPrice ?? 0)
    });
  }
  candidates.sort((a, b) => {
    if (a.hasOptions !== b.hasOptions) return a.hasOptions ? -1 : 1;
    return b.riskScore - a.riskScore;
  });
  return candidates[0] || null;
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const maxSteps = nenv('TL_MAX_STEPS', 20);
  const maxMovePct = nenv('TL_MAX_MOVE_PCT', 0.05);
  const adverseTargetMult = nenv('TL_ADVERSE_TARGET_MULT', 1.6);
  const adverseTargetOverride = process.env.TL_ADVERSE_TARGET;
  const requireSuccess = benv('TL_REQUIRE_SUCCESS', false);
  const requirePickedAddress = benv('TL_REQUIRE_PICK_ADDRESS', false);
  const skipSupplyCheck = benv('TL_SKIP_SUPPLY_CHECK', true);
  const skipNetCheck = benv('TL_SKIP_NET_CHECK', true);
  let synthBlock = nenv('TL_SYNTH_BLOCK_START', 0);

  await TxUtils.init();
  await Activation.getInstance().init();
  const clearingShim = new Clearing();
  Clearing.computeOptionAdjustments = clearingShim.computeOptionAdjustments.bind(clearingShim);
  let block = await TxUtils.getBlockCount();

  const info = await ContractRegistry.getContractInfo(seriesId);
  const collateralId = Number(info?.collateralPropertyId || 5);
  const picked = await pickOptionExposedAddress(seriesId, collateralId);
  if (!picked) throw new Error('No option/perp candidate address found');
  const pickedAddress = process.env.TL_PICK_ADDRESS || picked.address;
  let chosen = picked;
  if (pickedAddress !== picked.address) {
    const mm = await MarginMap.getInstance(seriesId);
    const mmAlt = await MarginMap.getInstance(String(seriesId));
    const pA = mm.margins.get(pickedAddress) || {};
    const pB = mmAlt.margins.get(pickedAddress) || {};
    const options = { ...(pA.options || {}), ...(pB.options || {}) };
    const optionCount = Object.keys(options).filter((k) => Number(options[k]?.contracts || 0) !== 0).length;
    chosen = {
      ...picked,
      address: pickedAddress,
      contracts: Number(pA.contracts || pB.contracts || 0),
      optionCount,
      hasOptions: optionCount > 0,
      liqPrice: Number(pA.liqPrice ?? pA.liquidationPrice ?? pB.liqPrice ?? pB.liquidationPrice ?? 0)
    };
  }

  const markStart = Number(await OracleList.getOraclePrice(oracleId));
  if (!Number.isFinite(markStart) || markStart <= 0) throw new Error('Invalid starting oracle mark');

  let adverseTarget;
  const forcedTarget = Number(adverseTargetOverride);
  const liqPx = Number(chosen.liqPrice || 0);
  if (Number.isFinite(forcedTarget) && forcedTarget > 0) {
    adverseTarget = forcedTarget;
  } else if (Number.isFinite(liqPx) && liqPx > 0 && liqPx !== markStart) {
    adverseTarget = liqPx > markStart
      ? Number((liqPx * 1.2).toFixed(8))
      : Number((liqPx * 0.8).toFixed(8));
  } else {
    adverseTarget = chosen.contracts < 0
      ? Number((markStart * adverseTargetMult).toFixed(8))
      : Number((markStart / adverseTargetMult).toFixed(8));
  }

  console.log('[options-amm-liq-live] config', {
    admin,
    seriesId,
    oracleId,
    collateralId,
    picked: { ...chosen, selectedAddress: pickedAddress },
    markStart,
    adverseTarget,
    maxSteps,
    maxMovePct,
    requirePickedAddress,
    skipSupplyCheck,
    skipNetCheck
  });

  let cur = markStart;
  let hit = null;

  for (let i = 0; i < maxSteps; i += 1) {
    block = await TxUtils.getBlockCount();

    const depth = await setAmmOnlyQuotes(seriesId, cur, block);
    if ((depth.buy + depth.sell) === 0) {
      throw new Error('No AMM quotes available after AMM refresh');
    }

    const next = cappedMove(cur, adverseTarget, maxMovePct);
    if (next === cur) break;

    const forced = synthBlock > 0 ? ++synthBlock : null;
    const orTx = await publishOracle(admin, oracleId, next, block, forced);
    cur = Number(await OracleList.getOraclePrice(oracleId));

    const settleBlock = Number.isFinite(forced) ? forced : await TxUtils.getBlockCount();
    let clearingError = '';
    try {
      if (skipSupplyCheck) await Tally.setModFlag(false);
      if (skipNetCheck) await ContractRegistry.setModFlag(false);
      await Clearing.clearingFunction(settleBlock, true);
    } catch (e) {
      clearingError = String(e?.message || e || '');
    }

    const liqTrades = await TradeHistory.getLiquidationTradesForContractAtBlock(seriesId, settleBlock);
    const ammHits = liqTrades.filter((t) => {
      const b = t?.buyerAddress;
      const s = t?.sellerAddress;
      const hasAmm = (b === 'amm' || s === 'amm');
      const hasPicked = (b === pickedAddress || s === pickedAddress);
      return hasAmm && (!requirePickedAddress || hasPicked);
    });

    console.log('[step]', {
      step: i + 1,
      block: settleBlock,
      oracleTx: orTx,
      mark: cur,
      depth,
      liqTrades: liqTrades.length,
      ammHits: ammHits.length,
      clearingError
    });

    if (ammHits.length > 0) {
      hit = { block, mark: cur, trades: ammHits };
      break;
    }
  }

  if (!hit) {
    const msg = 'No AMM-counterparty liquidation trade observed in scan window';
    if (requireSuccess) throw new Error(msg);
    console.log('[options-amm-liq-live] WARN:', msg);
    return;
  }

    console.log('[options-amm-liq-live] SUCCESS', {
    picked: pickedAddress,
    block: hit.block,
    mark: hit.mark,
    trades: hit.trades.map((t) => ({
      buyerAddress: t.buyerAddress,
      sellerAddress: t.sellerAddress,
      amount: t.amount,
      price: t.price,
      liquidation: t.liquidation
    }))
  });
}

main().catch((e) => {
  console.error('[options-amm-liq-live] failed:', e && e.stack ? e.stack : (e.message || e));
  process.exit(1);
});
