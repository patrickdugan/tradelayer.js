const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const db = require('./db');
const DlcOracleBridge = require('./dlcOracleBridge');

const ROUTE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CHALLENGED: 'CHALLENGED',
  FINALIZED: 'FINALIZED',
  INVALIDATED: 'INVALIDATED'
});

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256Hex(value) {
  const input = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : stableStringify(value), 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizePayouts(payouts = []) {
  return (Array.isArray(payouts) ? payouts : [])
    .map((entry) => ({
      address: String(entry.address || entry.toAddress || entry.recipientAddress || ''),
      weight: Number(entry.weight ?? entry.tokenAmount ?? entry.amount ?? 0),
      sats: Number(entry.sats ?? entry.amountSats ?? entry.valueSats ?? 0),
      tokenAmount: Number(entry.tokenAmount ?? entry.amount ?? entry.weight ?? 0)
    }))
    .filter((entry) => entry.address)
    .sort((a, b) => a.address.localeCompare(b.address) || a.weight - b.weight || a.sats - b.sats);
}

function parseEnvelopeFromWitnessScript(scriptHex) {
  const chunks = bitcoin.script.decompile(Buffer.from(scriptHex, 'hex')) || [];
  const buffers = chunks.filter(Buffer.isBuffer);
  if (!buffers.length || buffers[0].toString('utf8') !== 'TLPNLROUTE:1') {
    throw new Error('Reveal witness is not a TLPNLROUTE envelope');
  }
  const json = Buffer.concat(buffers.slice(1)).toString('utf8');
  return JSON.parse(json);
}

function validateEnvelope(envelope) {
  if (!envelope || envelope.envelope !== 'TLPNLROUTE') {
    return { valid: false, reason: 'Invalid TLPNLROUTE envelope' };
  }
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Missing PNL route payload' };
  }
  if (payload.protocol !== 'tl-utxoref-pnl-router') {
    return { valid: false, reason: 'Invalid PNL route protocol' };
  }
  const payloadHash = sha256Hex(payload);
  if (payloadHash !== String(envelope.payloadHash || '').toLowerCase()) {
    return { valid: false, reason: 'PNL route payload hash mismatch', payloadHash };
  }
  const relayCheck = DlcOracleBridge.validateRelayBundle(envelope.attestation, payloadHash);
  if (!relayCheck.valid) {
    return { valid: false, reason: `Invalid PNL route oracle attestation: ${relayCheck.reason}`, payloadHash };
  }
  if (!payload.dlcRef) {
    return { valid: false, reason: 'Missing PNL route dlcRef', payloadHash };
  }
  if (!Number.isFinite(Number(payload.propertyId)) || Number(payload.propertyId) <= 0) {
    return { valid: false, reason: 'Invalid PNL route propertyId', payloadHash };
  }
  const payouts = normalizePayouts(payload.utxoPayouts);
  if (!payouts.length) {
    return { valid: false, reason: 'PNL route has no payout recipients', payloadHash };
  }
  return { valid: true, payloadHash, payouts };
}

function buildRouteDigest(envelope, context = {}) {
  const check = validateEnvelope(envelope);
  if (!check.valid) throw new Error(check.reason);
  const payload = envelope.payload;
  const payoutVectorHash = sha256Hex(check.payouts);
  const tokenPnlHash = sha256Hex(payload.tokenPnl || []);
  const digest = {
    payloadHash: check.payloadHash,
    routeHash: sha256Hex({
      payloadHash: check.payloadHash,
      dlcRef: payload.dlcRef,
      propertyId: Number(payload.propertyId),
      payoutVectorHash,
      tokenPnlHash
    }),
    payoutVectorHash,
    tokenPnlHash,
    dlcRef: payload.dlcRef,
    propertyId: Number(payload.propertyId),
    revealTxid: context.revealTxid || '',
    commitTxid: context.commitTxid || '',
    block: Number(context.block || payload.block || 0),
    oraclePubkeyHex: envelope.attestation?.oraclePubkeyHex || '',
    payoutCount: check.payouts.length
  };
  return digest;
}

class PnlRouteRegistry {
  static async _base() {
    return db.getDatabase('procedural');
  }

  static challengeBlocks(raw) {
    const fallback = Number(process.env.TL_PNL_ROUTE_CHALLENGE_BLOCKS || 6);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return Math.max(0, fallback);
    return Math.floor(n);
  }

  static async recordEnvelope(envelope, context = {}) {
    const digest = buildRouteDigest(envelope, context);
    const base = await this._base();
    const key = `pnl-route-${digest.payloadHash}`;
    const block = Number(context.block || digest.block || 0);
    const challengeBlocks = this.challengeBlocks(context.challengeBlocks);
    const doc = {
      _id: key,
      type: 'pnlRouteReveal',
      status: ROUTE_STATUS.PENDING,
      ...digest,
      challengeBlocks,
      challengeDeadlineBlock: block + challengeBlocks,
      revealTxid: context.revealTxid || digest.revealTxid,
      commitTxid: context.commitTxid || digest.commitTxid,
      payload: envelope.payload,
      attestation: envelope.attestation,
      challenged: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async recordWitnessScript(scriptHex, context = {}) {
    const envelope = parseEnvelopeFromWitnessScript(scriptHex);
    return this.recordEnvelope(envelope, context);
  }

  static async get(payloadHash) {
    const base = await this._base();
    return base.findOneAsync({ _id: `pnl-route-${payloadHash}` });
  }

  static async challenge(payloadHash, detail = {}) {
    const base = await this._base();
    const key = `pnl-route-${payloadHash}`;
    const doc = await base.findOneAsync({ _id: key });
    if (!doc) throw new Error(`Unknown PNL route payloadHash: ${payloadHash}`);
    const evidence = detail.evidence || {};
    const reasons = [];
    if (evidence.expectedDlcRef && evidence.expectedDlcRef !== doc.dlcRef) {
      reasons.push('dlcRef mismatch');
    }
    if (evidence.expectedPropertyId && Number(evidence.expectedPropertyId) !== Number(doc.propertyId)) {
      reasons.push('propertyId mismatch');
    }
    if (evidence.expectedPayoutVectorHash && evidence.expectedPayoutVectorHash !== doc.payoutVectorHash) {
      reasons.push('payout vector hash mismatch');
    }
    if (evidence.expectedTokenPnlHash && evidence.expectedTokenPnlHash !== doc.tokenPnlHash) {
      reasons.push('token PNL hash mismatch');
    }
    if (evidence.expectedPayloadHash && evidence.expectedPayloadHash !== doc.payloadHash) {
      reasons.push('payload hash mismatch');
    }
    if (!reasons.length && detail.reason) reasons.push(String(detail.reason));
    if (!reasons.length) {
      throw new Error('PNL route challenge needs contradictory evidence');
    }

    const challenged = Array.isArray(doc.challenged) ? doc.challenged.slice() : [];
    challenged.push({
      challengerAddress: detail.challengerAddress || '',
      evidenceHash: detail.evidenceHash || sha256Hex(evidence),
      reason: reasons.join('; '),
      evidence,
      block: Number(detail.block || 0),
      ts: Date.now()
    });
    doc.status = ROUTE_STATUS.CHALLENGED;
    doc.challenged = challenged;
    doc.updatedAt = Date.now();
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async finalize(payloadHash, detail = {}) {
    const base = await this._base();
    const key = `pnl-route-${payloadHash}`;
    const doc = await base.findOneAsync({ _id: key });
    if (!doc) throw new Error(`Unknown PNL route payloadHash: ${payloadHash}`);
    if (doc.status === ROUTE_STATUS.CHALLENGED) {
      throw new Error(`PNL route challenged: ${payloadHash}`);
    }
    const atBlock = Number(detail.block || 0);
    if (atBlock < Number(doc.challengeDeadlineBlock || 0)) {
      throw new Error(`PNL route challenge window still open for ${payloadHash}`);
    }
    doc.status = ROUTE_STATUS.FINALIZED;
    doc.finalizedAtBlock = atBlock;
    doc.updatedAt = Date.now();
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }
}

module.exports = {
  PnlRouteRegistry,
  ROUTE_STATUS,
  parseEnvelopeFromWitnessScript,
  validateEnvelope,
  buildRouteDigest,
  normalizePayouts,
  sha256Hex,
  stableStringify
};
