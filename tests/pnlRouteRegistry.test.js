describe('PNL route witness registry', () => {
  const crypto = require('crypto');
  const secp = require('tiny-secp256k1');

  function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest();
  }

  function createSigner() {
    let priv;
    do {
      priv = crypto.randomBytes(32);
    } while (!secp.isPrivate(priv));
    const pubkey = Buffer.from(secp.pointFromScalar(priv, true)).toString('hex');
    return {
      signBundle(bundle) {
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
        const sig = secp.sign(sha256(Buffer.from(JSON.stringify(canonical), 'utf8')), priv);
        return {
          ...bundle,
          oraclePubkeyHex: pubkey,
          signatureHex: Buffer.from(sig).toString('hex')
        };
      }
    };
  }

  function loadHarness() {
    jest.resetModules();
    const docs = new Map();
    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async () => ({
        updateAsync: jest.fn(async (query, update) => {
          docs.set(query._id, update.$set || update);
          return 1;
        }),
        findOneAsync: jest.fn(async (query) => docs.get(query._id) || null)
      }))
    }));
    const mod = require('../src/pnlRouteRegistry.js');
    return { ...mod, docs };
  }

  function makeEnvelope(mod) {
    const payload = {
      protocol: 'tl-utxoref-pnl-router',
      version: 1,
      dlcRef: 'dlc-1',
      propertyId: 380,
      tokenPnl: [{ fromAddress: 'loser', toAddress: 'winner', tokenAmount: 1 }],
      utxoPayouts: [{ address: 'winner', weight: 1, tokenAmount: 1 }]
    };
    const payloadHash = mod.sha256Hex(payload);
    const attestation = createSigner().signBundle({
      eventId: 'dlc-1-pnl',
      outcome: 'PNL_ROUTE',
      outcomeIndex: 0,
      stateHash: payloadHash,
      payloadHash,
      timestamp: 1
    });
    return {
      envelope: 'TLPNLROUTE',
      payload,
      payloadHash,
      attestation
    };
  }

  test('records a digest for a valid witness route envelope', async () => {
    const mod = loadHarness();
    const envelope = makeEnvelope(mod);
    const doc = await mod.PnlRouteRegistry.recordEnvelope(envelope, {
      revealTxid: 'reveal-tx',
      commitTxid: 'commit-tx',
      block: 100,
      challengeBlocks: 4
    });

    expect(doc.status).toBe(mod.ROUTE_STATUS.PENDING);
    expect(doc.payloadHash).toBe(envelope.payloadHash);
    expect(doc.revealTxid).toBe('reveal-tx');
    expect(doc.challengeDeadlineBlock).toBe(104);
    expect(doc.payoutVectorHash).toBe(mod.sha256Hex(mod.normalizePayouts(envelope.payload.utxoPayouts)));
  });

  test('rejects tampered payloads with stale payloadHash', async () => {
    const mod = loadHarness();
    const envelope = makeEnvelope(mod);
    envelope.payload.dlcRef = 'evil-dlc';
    expect(mod.validateEnvelope(envelope).valid).toBe(false);
    await expect(mod.PnlRouteRegistry.recordEnvelope(envelope)).rejects.toThrow(/hash mismatch/i);
  });

  test('accepts contradictory evidence as a route challenge', async () => {
    const mod = loadHarness();
    const envelope = makeEnvelope(mod);
    const doc = await mod.PnlRouteRegistry.recordEnvelope(envelope, { block: 100 });
    const challenged = await mod.PnlRouteRegistry.challenge(doc.payloadHash, {
      challengerAddress: 'watchtower',
      evidence: {
        expectedPayoutVectorHash: '00'.repeat(32)
      },
      block: 101
    });

    expect(challenged.status).toBe(mod.ROUTE_STATUS.CHALLENGED);
    expect(challenged.challenged[0].reason).toMatch(/payout vector hash mismatch/);
  });

  test('rejects empty challenges with no contradictory evidence', async () => {
    const mod = loadHarness();
    const envelope = makeEnvelope(mod);
    const doc = await mod.PnlRouteRegistry.recordEnvelope(envelope, { block: 100 });

    await expect(mod.PnlRouteRegistry.challenge(doc.payloadHash, { evidence: {}, block: 101 }))
      .rejects.toThrow(/contradictory evidence/i);
  });
});
