const crypto = require('crypto');
const secp = require('tiny-secp256k1');
const TallyMap = require('../src/tally.js');
const Logic = require('../src/logic.js');
const db = require('../src/db.js');

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      out[body] = true;
      continue;
    }
    out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function canonicalRelayMessage(bundle) {
  const canonical = {
    eventId: String(bundle.eventId || ''),
    outcome: String(bundle.outcome || ''),
    outcomeIndex: Number(bundle.outcomeIndex || 0),
    stateHash: String(bundle.stateHash || ''),
    timestamp: Number(bundle.timestamp || 0)
  };
  if (bundle.payloadHash !== undefined && bundle.payloadHash !== null) {
    canonical.payloadHash = String(bundle.payloadHash);
  }
  return JSON.stringify(canonical);
}

async function currentBlockHint() {
  try {
    const consensus = await db.getDatabase('consensus');
    const row = await consensus.findOneAsync({ _id: 'MaxProcessedHeight' });
    const n = Number(row?.value || 0);
    if (Number.isFinite(n) && n > 0) return n + 1;
  } catch {}
  return 0;
}

async function buildStatePayload(propertyId) {
  await TallyMap.loadFromDB();
  const normalized = [];
  for (const [address, props] of (TallyMap.addresses || new Map()).entries()) {
    const bal = props?.[propertyId];
    if (!bal) continue;
    const available = Number(bal.available || 0);
    const reserved = Number(bal.reserved || 0);
    const margin = Number(bal.margin || 0);
    const vesting = Number(bal.vesting || 0);
    const channelBalance = Number(bal.channelBalance || 0);
    if (available <= 0 && reserved <= 0 && margin <= 0 && vesting <= 0 && channelBalance <= 0) continue;
    normalized.push({
      address: String(address || ''),
      available,
      reserved,
      margin,
      vesting,
      channelBalance
    });
  }
  normalized.sort((a, b) => a.address.localeCompare(b.address));

  const payload = {
    propertyId: Number(propertyId),
    holderCount: normalized.length,
    balances: normalized
  };
  const payloadJson = JSON.stringify(payload);
  return {
    payload,
    payloadJson,
    payloadHash: sha256Hex(payloadJson),
    payloadB64: Buffer.from(payloadJson, 'utf8').toString('base64')
  };
}

function buildSignedRelayBundle(opts, stateHash, payloadHash, payloadB64) {
  const privHex = String(opts.oraclePrivkeyHex || '').trim();
  const priv = /^[0-9a-fA-F]{64}$/.test(privHex) ? Buffer.from(privHex, 'hex') : null;
  const pubFromPriv = priv ? secp.pointFromScalar(priv, true) : null;

  const bundle = {
    eventId: String(opts.eventId || `proc-${opts.dlcRef || 'na'}`),
    outcome: String(opts.settlementState || opts.outcome || 'SETTLED'),
    outcomeIndex: Number(opts.outcomeIndex || 0),
    stateHash,
    timestamp: Number(opts.timestamp || Date.now()),
    payloadHash,
    balancePayloadB64: payloadB64,
    oraclePubkeyHex: String(opts.oraclePubkeyHex || (pubFromPriv ? Buffer.from(pubFromPriv).toString('hex') : '')),
    signatureHex: ''
  };

  if (priv) {
    const msg = canonicalRelayMessage(bundle);
    const digest = crypto.createHash('sha256').update(Buffer.from(msg, 'utf8')).digest();
    const sig = secp.sign(digest, priv);
    bundle.signatureHex = Buffer.from(sig).toString('hex');
  }
  return bundle;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const propertyId = Number(args.propertyId);
  const oracleId = Number(args.oracleId);
  const relayType = Number(args.relayType || 1);
  const senderAddress = String(args.oracleAddress || '');
  const dlcRef = String(args.dlcRef || '');
  const settlementState = String(args.settlementState || 'SETTLED').toUpperCase();
  const actionMode = String(args.settleAction || args.mode || '').toLowerCase();
  const amount = Number(args.amount || 0);
  const nextDlcRef = String(args.nextDlcRef || '');
  const autoRoll = String(args.autoRoll || '') === '1' || args.autoRoll === true;
  const block = Number.isFinite(Number(args.block)) ? Number(args.block) : await currentBlockHint();
  const dryRun = String(args.dryRun || '') === '1' || args.dryRun === true;

  if (!Number.isFinite(propertyId) || propertyId <= 0) {
    throw new Error('Missing/invalid --propertyId');
  }
  if (!Number.isFinite(oracleId) || oracleId <= 0) {
    throw new Error('Missing/invalid --oracleId');
  }
  if (!senderAddress) {
    throw new Error('Missing --oracleAddress');
  }

  const state = await buildStatePayload(propertyId);
  const stateHash = state.payloadHash;

  const settlement = {
    mode: actionMode || 'none',
    propertyId,
    amount,
    fromAddress: args.fromAddress || senderAddress,
    toAddress: args.toAddress || senderAddress,
    nextPropertyId: Number(args.nextPropertyId || 0)
  };

  const relayBundle = buildSignedRelayBundle(args, stateHash, state.payloadHash, state.payloadB64);
  relayBundle.settlement = settlement;
  const relayBlobJson = JSON.stringify(relayBundle);
  const relayBlob = args.relayBlobMode === 'b64'
    ? `b64:${Buffer.from(relayBlobJson, 'utf8').toString('base64')}`
    : relayBlobJson;

  const tx30Params = {
    action: 2,
    oracleId,
    relayType,
    stateHash,
    dlcRef,
    settlementState,
    relayBlob,
    autoRoll,
    nextDlcRef
  };

  console.log('[canonical-state-oracle] state', {
    propertyId,
    holderCount: state.payload.holderCount,
    stateHash
  });
  console.log('[canonical-state-oracle] relay', {
    oracleId,
    senderAddress,
    dlcRef,
    settlementState,
    relayType,
    mode: settlement.mode,
    autoRoll,
    nextDlcRef,
    block
  });

  if (dryRun) {
    console.log('[canonical-state-oracle] dryRun=1, skipping settlement apply');
    return;
  }

  await Logic.processStakeFraudProof(senderAddress, tx30Params, block);
  console.log('[canonical-state-oracle] relay + settlement applied');
}

main().catch((err) => {
  console.error('[canonical-state-oracle] error:', err.message);
  process.exit(1);
});
