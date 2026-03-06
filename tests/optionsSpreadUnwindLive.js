const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const MarginMap = require('../src/marginMap');
const Tally = require('../src/tally');
const Options = require('../src/options');
const Channels = require('../src/channels');

function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function extractTl(scriptHex) {
  const pos = scriptHex.indexOf('746c');
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString();
  if (!ascii.startsWith('tl')) return null;
  const type = parseInt(ascii.slice(2, 3), 36);
  return { marker: 'tl', type, encodedPayload: ascii.slice(3) };
}

async function applyTxNow(txid, senderAddress, blockHeight) {
  const tx = await TxUtils.getRawTransaction(txid);
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const p = extractTl(opret?.scriptPubKey?.hex || '');
  if (!p) throw new Error(`Unable to decode OP_RETURN for ${txid}`);
  const decoded = await Types.decodePayload(txid, p.type, p.marker, p.encodedPayload, senderAddress, null, 0, 0, blockHeight);
  decoded.block = blockHeight;
  if (decoded.valid !== true) throw new Error(decoded.reason || `invalid tx ${txid}`);
  await Logic.typeSwitch(p.type, decoded);
}

async function tryApplyTxNow(txid, senderAddress, blockHeight) {
  try {
    await applyTxNow(txid, senderAddress, blockHeight);
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e || '') };
  }
}

async function snapshot(seriesId, addr, spot) {
  const mm = await MarginMap.getInstance(seriesId);
  const pos = mm.margins.get(addr) || {};
  const options = pos.options || {};
  const t = await Tally.getTally(addr, nenv('TL_COLLATERAL_ID', 5));
  const legs = [];
  for (const [ticker, op] of Object.entries(options)) {
    const meta = Options.parseTicker(ticker);
    if (!meta) continue;
    const qty = Number(op?.contracts || 0);
    if (!qty) continue;
    legs.push({ type: meta.type, strike: Number(meta.strike || 0), qty, expiryBlock: Number(meta.expiryBlock || 0) });
  }
  return {
    available: Number(t?.available || 0),
    margin: Number(t?.margin || 0),
    optionCount: Object.keys(options).length,
    options,
    maintNaked: Options.portfolioMaintenance(legs, spot)
  };
}

async function resolveTrackAddress(channel, fallback) {
  if (process.env.TL_TRACK_ADDRESS) return process.env.TL_TRACK_ADDRESS;
  const ch = await Channels.getChannel(channel);
  const b = ch?.participants?.B;
  const a = ch?.participants?.A;
  return b || a || fallback;
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const seriesId = nenv('TL_SERIES_ID', 3);
  const spot = nenv('TL_SPOT', 108);
  const shortStrike = nenv('TL_SHORT_STRIKE', 120);
  const longStrike = nenv('TL_LONG_STRIKE', 130);
  const qty = nenv('TL_QTY', 1);
  const applyImmediate = String(process.env.TL_APPLY_IMMEDIATE || 'true').toLowerCase() === 'true';
  const expectLongOnlyReject = String(process.env.TL_EXPECT_LONG_ONLY_REJECT || 'true').toLowerCase() === 'true';

  await TxUtils.init();
  await Activation.getInstance().init();
  let block = await TxUtils.getBlockCount();
  const expiry = block + 120;
  const shortTicker = `${seriesId}-${expiry}-C-${shortStrike}`;
  const longTicker = `${seriesId}-${expiry}-C-${longStrike}`;
  const trackAddress = await resolveTrackAddress(channel, admin);

  console.log({ admin, channel, trackAddress, seriesId, shortTicker, longTicker, qty, applyImmediate });

  const before = await snapshot(seriesId, trackAddress, spot);
  console.log('[before]', before);

  const spreadTxid = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: shortTicker,
    comboTicker: longTicker,
    amount: qty,
    comboAmount: qty,
    price: 0,
    comboPrice: 0,
    columnAIsSeller: false,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  if (applyImmediate) await applyTxNow(spreadTxid, channel, block);

  const afterSpread = await snapshot(seriesId, trackAddress, spot);
  console.log('[after-spread]', afterSpread);

  const longOnlyUnwindTxid = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: longTicker,
    amount: qty,
    price: 0,
    columnAIsSeller: false,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  if (applyImmediate) {
    const longOnly = await tryApplyTxNow(longOnlyUnwindTxid, channel, block);
    console.log('[long-only-unwind]', longOnly);
    if (expectLongOnlyReject && longOnly.ok) {
      throw new Error('long-only unwind unexpectedly succeeded; expected reject with short-first policy');
    }
  }

  const comboUnwindTxid = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: shortTicker,
    comboTicker: longTicker,
    amount: qty,
    comboAmount: qty,
    price: 0,
    comboPrice: 0,
    columnAIsSeller: true,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  if (applyImmediate) await applyTxNow(comboUnwindTxid, channel, block);

  const afterUnwind = await snapshot(seriesId, trackAddress, spot);
  const marginDelta = Number((afterUnwind.margin - afterSpread.margin).toFixed(8));
  console.log('[after-combo-unwind]', { ...afterUnwind, marginDelta });
}

main().catch((e) => {
  console.error('optionsSpreadUnwindLive failed:', e.message || e);
  process.exit(1);
});

