const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const MarginMap = require('../src/marginMap');
const Options = require('../src/options');
const Channels = require('../src/channels');
const OracleList = require('../src/oracle');
const Clearing = require('../src/clearing');

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
  return {
    contracts: Number(pos.contracts || 0),
    liqPrice: Number(pos.liqPrice ?? pos.liquidationPrice ?? 0),
    options: optionsBag,
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

async function publishOracle(admin, oracleId, price, applyImmediate, blockHint) {
  const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price });
  if (applyImmediate) {
    const block = blockHint || await TxUtils.getBlockCount();
    await applyTxNow(txid, admin, block);
  }
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const spot = nenv('TL_SPOT', 108);
  const putStrike = nenv('TL_PUT_STRIKE', 120);
  const perpQty = nenv('TL_PERP_QTY', 1);
  const optionQty = nenv('TL_OPTION_QTY', 1);
  const openPerp = String(process.env.TL_OPEN_PERP || 'true').toLowerCase() === 'true';
  const bPerpLong = String(process.env.TL_B_PERP_LONG || 'true').toLowerCase() === 'true';
  const bPutLong = String(process.env.TL_B_PUT_LONG || 'true').toLowerCase() === 'true';
  const optionColumnAIsSeller = process.env.TL_OPTION_COLUMN_A_SELLER === undefined
    ? bPutLong
    : String(process.env.TL_OPTION_COLUMN_A_SELLER).toLowerCase() === 'true';
  const applyImmediate = String(process.env.TL_APPLY_IMMEDIATE || 'true').toLowerCase() === 'true';
  const targets = splitNums('TL_TARGET_SPOTS', '102,96,90,84');

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();
  const expiry = block + 120;
  const putTicker = `${seriesId}-${expiry}-P-${putStrike}`;
  const trackAddress = await resolveTrackAddress(channel, admin);

  await publishOracle(admin, oracleId, spot, applyImmediate, block);
  const tradePrice = Number(await OracleList.getOraclePrice(oracleId));

  if (openPerp) {
    const perpTx = await TxUtils.createChannelContractTradeTransaction(channel, {
      contractId: seriesId,
      price: tradePrice,
      amount: perpQty,
      columnAIsSeller: bPerpLong,
      expiryBlock: expiry,
      insurance: false,
      columnAIsMaker: true
    });
    if (applyImmediate) await applyTxNow(perpTx, channel, block);
  }

  const seed = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: putTicker,
    amount: optionQty,
    price: 0,
    columnAIsSeller: optionColumnAIsSeller,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  if (applyImmediate) await applyTxNow(seed, channel, block);

  const pre = await snapshot(seriesId, trackAddress, spot);
  console.log('[pre]', { trackAddress, putTicker, tradePrice, optionColumnAIsSeller, pre });

  for (const px of targets) {
    const h = await TxUtils.getBlockCount();
    await publishOracle(admin, oracleId, px, applyImmediate, h);
    try {
      await Clearing.clearingFunction(h, true);
    } catch (e) {
      console.log('[warn] clearing failure', e.message || e);
    }
    const s = await snapshot(seriesId, trackAddress, px);
    const liq = Clearing.getLiquidation(seriesId, trackAddress) || null;
    console.log('[step]', {
      spot: px,
      contracts: s.contracts,
      liqPrice: s.liqPrice,
      optionCount: Object.keys(s.options).length,
      options: s.options,
      maintNaked: s.maintNaked,
      liquidation: liq
    });
  }
}

main().catch((e) => {
  console.error('optionsPerpPutHedgeLive failed:', e.message || e);
  process.exit(1);
});

