/**
 * sendVestTest.js
 *
 * Purpose:
 * - Move protocol property 1 (tLTC account token) from admin to multiple addresses.
 * - Optionally apply each tx immediately through Types/Logic for local state progression.
 *
 * Required env:
 * - TL_ADMIN_ADDRESS
 * - TL_SENDVEST_TARGETS (comma-separated addresses)
 *
 * Optional env:
 * - TL_SENDVEST_AMOUNTS (comma-separated amounts; if one value, reused for all targets; default 10)
 * - TL_SENDVEST_PROPERTY_ID (default 1)
 * - TL_APPLY_IMMEDIATE=true|false (default true)
 * - TL_DRY_RUN=true|false (default false)
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : String(v);
}
function benv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}
function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}
function parseCsv(raw, min = 0) {
  const arr = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (arr.length < min) throw new Error(`Expected at least ${min} CSV values`);
  return arr;
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
  if (decoded.valid !== true) throw new Error(`tx invalid ${txid}: ${decoded.reason || 'unknown'}`);
  await Logic.typeSwitch(parsed.type, decoded);
}

async function main() {
  const admin = env('TL_ADMIN_ADDRESS');
  const targets = parseCsv(env('TL_SENDVEST_TARGETS'), 1);
  const amountsRaw = parseCsv(env('TL_SENDVEST_AMOUNTS', '10'), 1).map(Number);
  const propertyId = nenv('TL_SENDVEST_PROPERTY_ID', 1);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const dryRun = benv('TL_DRY_RUN', false);

  if (!admin) throw new Error('Missing TL_ADMIN_ADDRESS');
  if (amountsRaw.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error(`Invalid TL_SENDVEST_AMOUNTS=${env('TL_SENDVEST_AMOUNTS')}`);
  }

  const amounts = targets.map((_, i) => {
    if (amountsRaw.length === 1) return amountsRaw[0];
    return amountsRaw[i] ?? amountsRaw[amountsRaw.length - 1];
  });

  await TxUtils.init();
  const activation = Activation.getInstance();
  await activation.init();

  console.log('[sendVestTest] config', {
    admin,
    propertyId,
    applyImmediate,
    dryRun,
    sends: targets.map((t, i) => ({ to: t, amount: amounts[i] }))
  });
  if (dryRun) return;

  // Ensure send tx type active.
  const actTxid = await TxUtils.activationTransaction(admin, 2);
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(actTxid, admin, b);
  }
  console.log('[sendVestTest] activated tx2', actTxid);

  for (let i = 0; i < targets.length; i++) {
    const to = targets[i];
    const amount = amounts[i];
    const txid = await TxUtils.sendTransaction(admin, to, propertyId, amount, false);
    console.log('[sendVestTest] send tx', { to, amount, txid });
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(txid, admin, b);
      console.log('[sendVestTest] applied', { txid, block: b });
    }
  }

  console.log('[sendVestTest] SUCCESS');
}

main().catch((err) => {
  console.error('[sendVestTest] failed:', err.message || err);
  process.exit(1);
});

