const crypto = require('crypto');
const secp = require('tiny-secp256k1');

function makeInMemoryDb() {
  const rows = new Map();
  const match = (doc, query) =>
    Object.entries(query || {}).every(([k, v]) => doc && doc[k] === v);

  return {
    rows,
    findOneAsync: async (query) => {
      for (const row of rows.values()) {
        if (match(row, query)) return { ...row };
      }
      return null;
    },
    updateAsync: async (query, update, opts = {}) => {
      let key = query?._id;
      if (!key) {
        const hit = await this.findOneAsync(query);
        key = hit?._id;
      }
      if (!key && !opts.upsert) return 0;
      key = key || update?._id || query?._id;
      const prev = rows.get(key) || {};
      const next = update?.$set ? { ...prev, ...update.$set } : { ...prev, ...update };
      if (!next._id) next._id = key;
      rows.set(next._id, next);
      return 1;
    }
  };
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

function signedRelayBlob({ stateHash }) {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!secp.isPrivate(priv));
  const pub = secp.pointFromScalar(priv, true);

  const payload = Buffer.from(JSON.stringify({ propertyId: 5, balances: [] }), 'utf8');
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  const bundle = {
    eventId: 'ev-replay',
    outcome: 'SETTLED',
    outcomeIndex: 0,
    stateHash,
    timestamp: 1700000010,
    payloadHash,
    balancePayloadB64: payload.toString('base64'),
    oraclePubkeyHex: Buffer.from(pub).toString('hex'),
    signatureHex: ''
  };
  const digest = crypto.createHash('sha256').update(Buffer.from(canonicalRelayMessage(bundle), 'utf8')).digest();
  bundle.signatureHex = Buffer.from(secp.sign(digest, priv)).toString('hex');
  return JSON.stringify(bundle);
}

describe('Oracle relay signature replay protection', () => {
  test('same signature is idempotent for same stateHash + dlcRef and rejected otherwise', async () => {
    jest.resetModules();
    const oracleData = makeInMemoryDb();
    const oracleList = makeInMemoryDb();

    jest.doMock('../src/db', () => ({
      getDatabase: async (name) => (name === 'oracleData' ? oracleData : oracleList)
    }));

    const OracleList = require('../src/oracle.js');
    const blob = signedRelayBlob({ stateHash: 'state-a' });

    await expect(
      OracleList.relayTradeLayerState(2, 'oracleAdmin', 1, 'state-a', 'dlc-1', 1000, blob)
    ).resolves.toBeTruthy();

    await expect(
      OracleList.relayTradeLayerState(2, 'oracleAdmin', 1, 'state-a', 'dlc-1', 1001, blob)
    ).resolves.toBeTruthy();

    await expect(
      OracleList.relayTradeLayerState(2, 'oracleAdmin', 1, 'state-a', 'dlc-2', 1002, blob)
    ).rejects.toThrow(/replay detected/i);

    await expect(
      OracleList.relayTradeLayerState(2, 'oracleAdmin', 1, 'state-b', 'dlc-1', 1003, blob)
    ).rejects.toThrow(/replay detected/i);
  });
});

