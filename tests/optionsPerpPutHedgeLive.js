const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const MarginMap = require('../src/marginMap');
const Options = require('../src/options');

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

function extractTl(scriptHex) {
  const pos = scriptHex.indexOf('746c');
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString();
  if (!ascii.startsWith('tl')) return null;
  return { marker: 'tl', type: parseInt(ascii.slice(2, 3), 36), encodedPayload: ascii.slice(3) };
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

async function snapshot(seriesId, addr, spot) {
  const mm = await MarginMap.getInstance(seriesId);
  const pos = mm.margins.get(addr) || {};
  const optionsBag = pos.options || {};
  const legs = [];
  for (const [ticker, op] of Object.entries(optionsBag)) {
    const meta = Options.parseTicker(ticker);
    if (!meta) continue;
    const qty = Number(op?.contracts || 0);
    if (!qty) continue;
    legs.push({ type: meta.type, strike: Number(meta.strike || 0), qty, expiryBlock: Number(meta.expiryBlock || 0) });
  }
  return { contracts: Number(pos.contracts || 0), options: optionsBag, maintNaked: Options.portfolioMaintenance(legs, spot) };
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const seriesId = nenv('TL_SERIES_ID', 3);
  const spot = nenv('TL_SPOT', 108);
  const putStrike = nenv('TL_PUT_STRIKE', 120);
  const applyImmediate = String(process.env.TL_APPLY_IMMEDIATE || 'true').toLowerCase() === 'true';
  const targets = splitNums('TL_TARGET_SPOTS', '102,96,90');

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();
  const expiry = block + 120;
  const putTicker = `${seriesId}-${expiry}-P-${putStrike}`;

  const pre = await snapshot(seriesId, admin, spot);
  console.log('[pre]', pre);

  const seed = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: putTicker,
    amount: 1,
    price: 0,
    columnAIsSeller: false,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  if (applyImmediate) await applyTxNow(seed, channel, block);

  try {
    const reverse = await TxUtils.createOptionTradeTransaction(channel, {
      contractId: putTicker,
      amount: 2,
      price: 0,
      columnAIsSeller: true,
      expiryBlock: expiry,
      columnAIsMaker: true
    });
    if (applyImmediate) await applyTxNow(reverse, channel, block);
  } catch (e) {
    console.log('[warn] reverse leg blocked by margin checks:', e.message || e);
  }

  for (const px of targets) {
    const s = await snapshot(seriesId, admin, px);
    console.log('[step]', { spot: px, contracts: s.contracts, optionCount: Object.keys(s.options).length, maintNaked: s.maintNaked });
  }
}

main().catch((e) => {
  console.error('optionsPerpPutHedgeLive failed:', e.message || e);
  process.exit(1);
});

