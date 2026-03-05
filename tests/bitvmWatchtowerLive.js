/**
 * BitVM watchtower (one-shot) for LTCTEST/LTC environments.
 *
 * Modes:
 * - alert only (default)
 * - auto-challenge due-soon caches
 *
 * Env:
 *   TL_WATCH_WINDOW_BLOCKS=2
 *   TL_WATCH_MODE=alert|challenge
 *   TL_APPLY_IMMEDIATE=true|false
 *   TL_ORACLE_ADMIN_ADDRESS=<oracle-admin-address>
 *   TL_CHALLENGER_ADDRESS=<challenger-address>
 *   TL_ORACLE_ID=1
 *   TL_CHALLENGE_BOND_AMOUNT=0
 *   TL_CHALLENGE_BOND_PROPERTY_ID=1
 */

const crypto = require('crypto');
const secp = require('tiny-secp256k1');
const db = require('../src/db');
const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');

function env(name, fallback = '') {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

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

function parseTl(scriptHex) {
  const markerHex = '746c';
  const pos = String(scriptHex || '').indexOf(markerHex);
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString();
  if (!ascii.startsWith('tl')) return null;
  const type = parseInt(ascii.slice(2, 3), 36);
  if (!Number.isFinite(type)) return null;
  return { marker: 'tl', type, encodedPayload: ascii.slice(3) };
}

async function decodeTxWithSender(txid, senderAddress, blockHeight) {
  const tx = await TxUtils.getRawTransaction(txid);
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTl(opret?.scriptPubKey?.hex || '');
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
  return { parsed, decoded };
}

async function applyTxNow(txid, senderAddress, blockHeight) {
  const { parsed, decoded } = await decodeTxWithSender(txid, senderAddress, blockHeight);
  if (decoded.valid !== true) {
    throw new Error(`tx invalid ${txid}: ${decoded.reason || 'unknown'}`);
  }
  await Logic.typeSwitch(parsed.type, decoded);
  return parsed.type;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function canonicalRelayMessage(bundle) {
  return JSON.stringify({
    eventId: String(bundle.eventId || ''),
    outcome: String(bundle.outcome || ''),
    outcomeIndex: Number(bundle.outcomeIndex || 0),
    stateHash: String(bundle.stateHash || ''),
    timestamp: Number(bundle.timestamp || 0)
  });
}

function getRelaySigningKey() {
  const raw = env('TL_ORACLE_RELAY_PRIVKEY', '').trim();
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    const key = Buffer.from(raw, 'hex');
    if (secp.isPrivate(key)) return key;
  }
  for (;;) {
    const key = crypto.randomBytes(32);
    if (secp.isPrivate(key)) return key;
  }
}

function relayBlob(settlement, stateHash, relayPrivkey) {
  const doc = {
    eventId: `bitvm-watchtower-${Date.now()}`,
    outcome: 'DISPUTED',
    outcomeIndex: 0,
    stateHash,
    timestamp: Date.now(),
    settlement,
    oraclePubkeyHex: Buffer.from(secp.pointFromScalar(relayPrivkey, true)).toString('hex')
  };
  const msg = canonicalRelayMessage(doc);
  const msgHash = sha256(Buffer.from(msg, 'utf8'));
  doc.signatureHex = Buffer.from(secp.sign(msgHash, relayPrivkey)).toString('hex');
  return 'b64:' + Buffer.from(JSON.stringify(doc), 'utf8').toString('base64');
}

async function main() {
  const mode = env('TL_WATCH_MODE', 'alert').toLowerCase();
  const windowBlocks = nenv('TL_WATCH_WINDOW_BLOCKS', 2);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS') || env('TL_ADMIN_ADDRESS');
  const challenger = env('TL_CHALLENGER_ADDRESS', oracleAdmin);
  const oracleId = nenv('TL_ORACLE_ID', 1);
  const challengeBondAmount = nenv('TL_CHALLENGE_BOND_AMOUNT', 0);
  const challengeBondPropertyId = nenv('TL_CHALLENGE_BOND_PROPERTY_ID', 1);

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();
  const proceduralDb = await db.getDatabase('procedural');
  const caches = await proceduralDb.findAsync({ type: 'bitvmCache', status: 'PENDING' });
  const due = (caches || []).filter((c) => Number(c.challengeDeadlineBlock || 0) <= block + windowBlocks);

  console.log('[bitvm-watchtower] scan', {
    block,
    mode,
    windowBlocks,
    pending: (caches || []).length,
    dueSoon: due.length
  });

  if (due.length === 0) {
    console.log('[bitvm-watchtower] no due caches');
    return;
  }

  for (const c of due) {
    console.log('[bitvm-watchtower] due', {
      cacheId: c.cacheId,
      dlcRef: c.dlcRef,
      deadline: c.challengeDeadlineBlock,
      amount: c.amount,
      propertyId: c.propertyId,
      fromAddress: c.fromAddress,
      toAddress: c.toAddress
    });
  }

  if (mode !== 'challenge') return;
  if (!oracleAdmin) throw new Error('TL_ORACLE_ADMIN_ADDRESS (or TL_ADMIN_ADDRESS) required for challenge mode');

  const relayPrivkey = getRelaySigningKey();
  const challengeTxids = [];
  for (const c of due) {
    const stateHash = `watchtower-${c.cacheId}-${Date.now()}`;
    const txid = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
      action: 2,
      oracleId,
      stakedPropertyId: Number(c.propertyId || challengeBondPropertyId),
      amount: 0,
      accusedAddress: '',
      evidenceHash: '',
      relayType: 1,
      stateHash,
      dlcRef: c.dlcRef || '',
      settlementState: 'DISPUTED',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: c.cacheId,
        challengerAddress: challenger,
        challengeBondAmount,
        challengeBondPropertyId
      }, stateHash, relayPrivkey)
    });
    if (applyImmediate) {
      await applyTxNow(txid, oracleAdmin, block);
    }
    challengeTxids.push({ cacheId: c.cacheId, txid });
  }

  console.log('[bitvm-watchtower] challenge submissions', challengeTxids);
}

main().catch((e) => {
  console.error('[bitvm-watchtower] failed:', e.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
