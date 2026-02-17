const crypto = require('crypto');
const secp = require('tiny-secp256k1');
const DlcOracleBridge = require('../src/dlcOracleBridge.js');

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
  if (bundle.payloadHash !== undefined && bundle.payloadHash !== null) {
    canonical.payloadHash = String(bundle.payloadHash);
  }
  return JSON.stringify(canonical);
}

function signedBundle(overrides = {}) {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!secp.isPrivate(priv));
  const pub = secp.pointFromScalar(priv, true);

  const payloadRaw = Buffer.from(JSON.stringify({ x: 1, y: 2 }), 'utf8');
  const payloadHash = crypto.createHash('sha256').update(payloadRaw).digest('hex');

  const bundle = {
    eventId: 'dlc-event-1',
    outcome: 'SETTLED',
    outcomeIndex: 0,
    stateHash: 'state-abc-123',
    timestamp: 1700000000,
    payloadHash,
    balancePayloadB64: payloadRaw.toString('base64'),
    oraclePubkeyHex: Buffer.from(pub).toString('hex'),
    signatureHex: ''
  };
  Object.assign(bundle, overrides);
  const msg = canonicalRelayMessage(bundle);
  const sig = secp.sign(sha256(Buffer.from(msg, 'utf8')), priv);
  bundle.signatureHex = Buffer.from(sig).toString('hex');
  return bundle;
}

describe('DlcOracleBridge adversarial relay validation', () => {
  test('accepts valid signed relay bundle', () => {
    const bundle = signedBundle();
    const out = DlcOracleBridge.validateRelayBundle(bundle, bundle.stateHash);
    expect(out.valid).toBe(true);
  });

  test('rejects tampered state hash', () => {
    const bundle = signedBundle();
    bundle.stateHash = 'tampered-hash';
    const out = DlcOracleBridge.validateRelayBundle(bundle, 'state-abc-123');
    expect(out.valid).toBe(false);
  });

  test('rejects payload hash mismatch', () => {
    const bundle = signedBundle({ payloadHash: 'f'.repeat(64) });
    const out = DlcOracleBridge.validateRelayBundle(bundle, bundle.stateHash);
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/payloadHash mismatch/i);
  });

  test('rejects invalid signature', () => {
    const bundle = signedBundle();
    bundle.signatureHex = '0'.repeat(128);
    const out = DlcOracleBridge.validateRelayBundle(bundle, bundle.stateHash);
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/signature/i);
  });
});

