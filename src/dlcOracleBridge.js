const crypto = require('crypto');
const secp = require('tiny-secp256k1');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function canonicalRelayMessage(bundle) {
  const canonical = {
    eventId: String(bundle.eventId || ''),
    outcome: String(bundle.outcome || ''),
    outcomeIndex: Number(bundle.outcomeIndex || 0),
    stateHash: String(bundle.stateHash || ''),
    timestamp: Number(bundle.timestamp || 0)
  };
  return JSON.stringify(canonical);
}

function toPubkeyBuffer(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.trim();
  if (![66, 130].includes(clean.length)) return null;
  return Buffer.from(clean, 'hex');
}

function toSigBuffer(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.trim();
  if (clean.length !== 128) return null;
  return Buffer.from(clean, 'hex');
}

const DlcOracleBridge = {
  fromNodeDlcLike(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      eventId: raw.eventId || raw.oracleEventId || raw.event_id || '',
      outcome: raw.outcome || (Array.isArray(raw.outcomes) ? raw.outcomes[0] : '') || '',
      outcomeIndex: raw.outcomeIndex ?? raw.outcome_index ?? 0,
      stateHash: raw.stateHash || raw.tradeLayerStateHash || raw.state_hash || '',
      timestamp: raw.timestamp || raw.eventMaturityEpoch || raw.event_maturity_epoch || 0,
      oraclePubkeyHex: raw.oraclePubkeyHex || raw.oraclePubkey || raw.oracle_public_key || '',
      signatureHex: raw.signatureHex || (Array.isArray(raw.signatures) ? raw.signatures[0] : '') || ''
    };
  },

  parseRelayBlob(relayBlob) {
    if (!relayBlob) return null;
    try {
      const parsed = JSON.parse(relayBlob);
      return this.fromNodeDlcLike(parsed) || parsed;
    } catch {
      return null;
    }
  },

  validateRelayBundle(bundle, expectedStateHash = '') {
    if (!bundle || typeof bundle !== 'object') {
      return { valid: false, reason: 'Missing relay bundle' };
    }
    const pubkey = toPubkeyBuffer(bundle.oraclePubkeyHex);
    const sig = toSigBuffer(bundle.signatureHex);
    if (!pubkey || !sig) {
      return { valid: false, reason: 'Invalid oracle pubkey/signature encoding' };
    }

    const message = canonicalRelayMessage(bundle);
    const msgHash = sha256(Buffer.from(message, 'utf8'));
    const verified = secp.verify(msgHash, pubkey, sig);
    if (!verified) {
      return { valid: false, reason: 'Invalid oracle relay signature' };
    }

    if (expectedStateHash && String(bundle.stateHash || '') !== String(expectedStateHash)) {
      return { valid: false, reason: 'Relay state hash mismatch' };
    }
    return { valid: true };
  }
};

module.exports = DlcOracleBridge;
