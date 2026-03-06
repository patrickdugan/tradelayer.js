/**
 * Live forced-expiry assignment harness.
 *
 * Purpose:
 * - Stage a real option trade (tx type 27)
 * - Force expiry settlement
 * - Verify option leg is removed and assigned underlying delta is opened
 *
 * Typical usage (testnet wallet):
 *   WALLET_NAME=wallet.dat TL_APPLY_IMMEDIATE=true npm run test:options-forced-assignment-live
 *
 * Key env vars:
 * - TL_ADMIN_ADDRESS
 * - TL_CHANNEL_ADDRESS
 * - TL_SERIES_ID (default 3)
 * - TL_ORACLE_ID (default 2)
 * - TL_OPTION_TYPE (C|P, default P)
 * - TL_OPTION_STRIKE (default 120)
 * - TL_OPTION_AMOUNT (default 1)
 * - TL_COLUMN_A_IS_SELLER (default true)
 * - TL_TRACK_SIDE (A|B, default B)
 * - TL_SPOT_OPEN (default 108)
 * - TL_SPOT_SETTLE (default 100 for puts, 130 for calls)
 * - TL_EXPIRY_OFFSET (default 40 blocks)
 * - TL_BLOCKS_PER_DAY (default 144)
 * - TL_APPLY_IMMEDIATE (default true)
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Channels = require('../src/channels');
const MarginMap = require('../src/marginMap');
const Clearing = require('../src/clearing');
const OracleList = require('../src/oracle');
const Options = require('../src/options');

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
}

async function publishOracle(admin, oracleId, price, applyImmediate, blockHint) {
  const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price });
  if (applyImmediate) {
    const h = Number.isFinite(blockHint) ? blockHint : await TxUtils.getBlockCount();
    await applyTxNow(txid, admin, h);
  }
  return txid;
}

function computeTrackSignedQty(trackSide, columnAIsSeller, amount) {
  const qty = Math.abs(Number(amount || 0));
  if (trackSide === 'A') return columnAIsSeller ? -qty : qty;
  return columnAIsSeller ? qty : -qty;
}

function computeAssignedContracts(type, signedOptionQty) {
  const q = Number(signedOptionQty || 0);
  const abs = Math.abs(q);
  if (!abs) return 0;
  if (type === 'C') return q > 0 ? abs : -abs;
  return q > 0 ? -abs : abs;
}

function isITM(type, strike, spot) {
  if (type === 'C') return Number(spot) > Number(strike);
  return Number(spot) < Number(strike);
}

function summarizePos(pos, ticker) {
  const p = pos || {};
  return {
    contracts: Number(p.contracts || 0),
    avgPrice: Number(p.avgPrice || 0),
    margin: Number(p.margin || 0),
    option: (p.options || {})[ticker] || null,
    optionCount: Object.keys(p.options || {}).length
  };
}

function computeAggregateExpectedDelta(optionsBag, spot, settleBlock) {
  let total = 0;
  for (const [ticker, op] of Object.entries(optionsBag || {})) {
    const meta = Options.parseTicker(ticker);
    if (!meta) continue;
    if (Number(meta.expiryBlock || 0) > Number(settleBlock || 0)) continue;
    const qty = Number(op?.contracts || 0);
    if (!qty) continue;
    const isCall = meta.type === 'Call';
    const optionType = isCall ? 'C' : 'P';
    const strike = Number(meta.strike || 0);
    if (!isITM(optionType, strike, spot)) continue;
    total += computeAssignedContracts(optionType, qty);
  }
  return total;
}

async function resolveTrackAddress(channelAddress, trackSide, admin) {
  const ch = await Channels.getChannel(channelAddress);
  if (trackSide === 'A') return ch?.participants?.A || admin;
  return ch?.participants?.B || ch?.participants?.A || admin;
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const optionType = String(process.env.TL_OPTION_TYPE || 'P').toUpperCase();
  if (optionType !== 'C' && optionType !== 'P') throw new Error(`TL_OPTION_TYPE must be C or P, got ${optionType}`);
  const strike = nenv('TL_OPTION_STRIKE', 120);
  const amount = nenv('TL_OPTION_AMOUNT', 1);
  const price = nenv('TL_OPTION_PRICE', 0);
  const columnAIsSeller = benv('TL_COLUMN_A_IS_SELLER', true);
  const trackSide = String(process.env.TL_TRACK_SIDE || 'B').toUpperCase() === 'A' ? 'A' : 'B';
  const spotOpen = nenv('TL_SPOT_OPEN', 108);
  const defaultSettle = optionType === 'P' ? 100 : 130;
  const spotSettle = nenv('TL_SPOT_SETTLE', defaultSettle);
  const expiryOffset = nenv('TL_EXPIRY_OFFSET', 40);
  const blocksPerDay = nenv('TL_BLOCKS_PER_DAY', 144);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const activate = benv('TL_ACTIVATE_OPTION_TX', true);

  await TxUtils.init();
  await Activation.getInstance().init();

  const block = await TxUtils.getBlockCount();
  const expiryBlock = block + expiryOffset;
  const ticker = `${seriesId}-${expiryBlock}-${optionType}-${strike}`;
  const trackAddress = await resolveTrackAddress(channel, trackSide, admin);

  console.log('[forced-assign-live] config', {
    admin,
    channel,
    seriesId,
    oracleId,
    ticker,
    amount,
    price,
    columnAIsSeller,
    trackSide,
    trackAddress,
    block,
    expiryBlock,
    spotOpen,
    spotSettle,
    applyImmediate
  });

  if (activate) {
    const actTx = await TxUtils.activationTransaction(admin, 27);
    if (applyImmediate) await applyTxNow(actTx, admin, block);
    console.log('[forced-assign-live] activated tx 27', actTx);
  }

  await publishOracle(admin, oracleId, spotOpen, applyImmediate, block);

  const optionTxid = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: ticker,
    amount,
    price,
    columnAIsSeller,
    expiryBlock,
    columnAIsMaker: true
  });
  if (applyImmediate) await applyTxNow(optionTxid, channel, block);
  console.log('[forced-assign-live] option tx', optionTxid);

  const mm = await MarginMap.getInstance(seriesId);
  const beforePos = mm.margins.get(trackAddress) || {};
  const before = summarizePos(beforePos, ticker);
  console.log('[forced-assign-live] before expiry', before);

  await publishOracle(admin, oracleId, spotSettle, applyImmediate, block + 1);
  await Clearing.settleOptionExpiries(seriesId, expiryBlock, spotSettle, blocksPerDay, `forced-exp-${Date.now()}`);

  const mmAfter = await MarginMap.getInstance(seriesId);
  const after = summarizePos(mmAfter.margins.get(trackAddress), ticker);
  console.log('[forced-assign-live] after expiry', after);

  const signedOptionQty = computeTrackSignedQty(trackSide, columnAIsSeller, amount);
  const expectedDeltaNewTicker = isITM(optionType, strike, spotSettle)
    ? computeAssignedContracts(optionType, signedOptionQty)
    : 0;
  const expectedDelta = computeAggregateExpectedDelta(beforePos.options || {}, spotSettle, expiryBlock);
  const observedDelta = Number(after.contracts) - Number(before.contracts);

  console.log('[forced-assign-live] expectation', {
    signedOptionQty,
    expectedDeltaNewTicker,
    expectedDelta,
    observedDelta,
    itm: isITM(optionType, strike, spotSettle)
  });

  if (expectedDelta !== observedDelta) {
    throw new Error(`Assignment mismatch expectedDelta=${expectedDelta} observedDelta=${observedDelta}`);
  }
  if (after.option !== null) {
    throw new Error('Expired option leg still present after settlement');
  }

  console.log('[forced-assign-live] SUCCESS');
}

main().catch((e) => {
  console.error('[forced-assign-live] failed:', e.message || e);
  process.exit(1);
});
