const crypto = require('crypto');
const DlcOracleBridge = require('../src/dlcOracleBridge');
const { createOracleSigner } = require('./makeshiftOracle');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('DlcOracleBridge payload-hash validation', () => {
  test('accepts b64 relay blob and validates payload hash', () => {
    const signer = createOracleSigner();
    const balancePayloadB64 = Buffer.from(JSON.stringify({ rows: [{ a: 1 }] }), 'utf8').toString('base64');
    const payloadHash = sha256Hex(Buffer.from(balancePayloadB64, 'base64'));
    const stateHash = payloadHash;

    const bundle = signer.signBundle({
      eventId: 'ct-balance',
      outcome: 'BALANCE_BUCKETS',
      outcomeIndex: 2,
      stateHash,
      payloadHash,
      timestamp: 123
    });
    const blob = 'b64:' + Buffer.from(JSON.stringify({ ...bundle, balancePayloadB64 }), 'utf8').toString('base64');
    const parsed = DlcOracleBridge.parseRelayBlob(blob);
    const out = DlcOracleBridge.validateRelayBundle(parsed, stateHash);
    expect(out.valid).toBe(true);
  });

  test('rejects mismatched payloadHash', () => {
    const signer = createOracleSigner();
    const balancePayloadB64 = Buffer.from(JSON.stringify({ rows: [{ a: 2 }] }), 'utf8').toString('base64');
    const payloadHash = 'f'.repeat(64);
    const stateHash = payloadHash;
    const bundle = signer.signBundle({
      eventId: 'ct-balance',
      outcome: 'BALANCE_BUCKETS',
      outcomeIndex: 2,
      stateHash,
      payloadHash,
      timestamp: 456
    });
    const out = DlcOracleBridge.validateRelayBundle(
      { ...bundle, balancePayloadB64 },
      stateHash
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/payloadHash mismatch/i);
  });
});
