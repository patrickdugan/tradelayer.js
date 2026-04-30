describe('tx30 relay settlement modes', () => {
  const crypto = require('crypto');
  const BinohashAdapter = require('../src/experimental/binohash/binohashAdapter');

  function loadHarness() {
    jest.resetModules();

    const updates = [];
    const redeemCalls = [];
    const grantCalls = [];

    jest.doMock('../src/tally.js', () => ({
      updateBalance: jest.fn(async (...args) => {
        updates.push(args);
      }),
      hasSufficientBalance: jest.fn(async () => ({ hasSufficient: true }))
    }));

    jest.doMock('../src/property.js', () => ({
      getInstance: () => ({
        redeemTokens: jest.fn(async (...args) => {
          redeemCalls.push(args);
        }),
        grantTokens: jest.fn(async (...args) => {
          grantCalls.push(args);
        })
      })
    }));

    jest.doMock('../src/oracle.js', () => ({
      relayTradeLayerState: jest.fn(async () => ({}))
    }));

    const transitions = [];
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        transitionContract: jest.fn(async (contractId, state) => {
          transitions.push({ contractId, state });
        })
      }
    }));

    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/activation.js', () => ({ getInstance: () => ({}) }));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({ ScalingL2: {} }));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/types.js', () => ({}));
    jest.doMock('../src/txEncoder.js', () => ({}));
    jest.doMock('../src/txDecoder.js', () => ({}));
    jest.doMock('../src/validity.js', () => ({}));

    const Logic = require('../src/logic.js');
    return { Logic, updates, redeemCalls, grantCalls, transitions };
  }

  function mkAnchoredPayload(settlement, params = {}) {
    const transitionHash = crypto.createHash('sha256').update(JSON.stringify({
      mode: String(settlement.mode || settlement.action || '').toLowerCase(),
      propertyId: Number(settlement.propertyId || 0),
      amount: Number(settlement.amount || 0),
      fromAddress: String(settlement.fromAddress || settlement.holderAddress || ''),
      toAddress: String(settlement.toAddress || settlement.recipientAddress || ''),
      cacheId: String(settlement.cacheId || ''),
      dlcRef: String(params.dlcRef || ''),
      stateHash: String(params.stateHash || '')
    })).digest('hex');
    const payloadDoc = {
      stateRoot: 'root-a1',
      transitions: [transitionHash]
    };
    const balancePayloadB64 = Buffer.from(JSON.stringify(payloadDoc), 'utf8').toString('base64');
    const payloadHash = crypto.createHash('sha256').update(Buffer.from(balancePayloadB64, 'base64')).digest('hex');
    return { transitionHash, payloadDoc, balancePayloadB64, payloadHash };
  }

  test('relayBlob settlement mode=redeem burns procedural balance', async () => {
    const { Logic, redeemCalls } = loadHarness();
    const relayBlob = JSON.stringify({
      eventId: 'ev1',
      outcome: 'SETTLED',
      outcomeIndex: 0,
      stateHash: 's1',
      timestamp: 1,
      oraclePubkeyHex: '',
      signatureHex: '',
      settlement: {
        mode: 'redeem',
        propertyId: 77,
        amount: 5.25,
        fromAddress: 'holderA'
      }
    });

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 's1',
      relayBlob
    }, 500);

    expect(redeemCalls).toEqual([[77, 'holderA', 5.25, 500]]);
  });

  test('relayBlob settlement mode=rollover redeems old and grants new', async () => {
    const { Logic, redeemCalls, grantCalls } = loadHarness();
    const relayBlob = JSON.stringify({
      eventId: 'ev2',
      outcome: 'ROLLED',
      outcomeIndex: 0,
      stateHash: 's2',
      timestamp: 2,
      settlement: {
        mode: 'rollover',
        propertyId: 77,
        nextPropertyId: 88,
        amount: 9,
        fromAddress: 'holderA',
        toAddress: 'holderB'
      }
    });

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 's2',
      relayBlob
    }, 501);

    expect(redeemCalls).toEqual([[77, 'holderA', 9, 501]]);
    expect(grantCalls).toEqual([[88, 'holderB', 9, 501]]);
  });

  test('relayBlob settlement mode=pnl_sweep moves available balance', async () => {
    const { Logic, updates } = loadHarness();
    const relayBlob = JSON.stringify({
      eventId: 'ev3',
      outcome: 'SETTLED',
      outcomeIndex: 0,
      stateHash: 's3',
      timestamp: 3,
      settlement: {
        mode: 'pnl_sweep',
        propertyId: 5,
        amount: 1.75,
        fromAddress: 'liqPool',
        toAddress: 'winner'
      }
    });

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 's3',
      relayBlob
    }, 502);

    expect(updates).toEqual([
      ['liqPool', 5, -1.75, 0, 0, 0, 'oraclePnlSweep', 502],
      ['winner', 5, 1.75, 0, 0, 0, 'oraclePnlSweep', 502]
    ]);
  });

  test('state-root gate rejects unanchored settlement when required', async () => {
    const prev = process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
    process.env.TL_ORACLE_REQUIRE_STATE_ROOT = '1';
    try {
      const { Logic } = loadHarness();
      const relayBlob = JSON.stringify({
        eventId: 'ev4',
        outcome: 'SETTLED',
        outcomeIndex: 0,
        stateHash: 's4',
        timestamp: 4,
        settlement: {
          mode: 'pnl_sweep',
          propertyId: 5,
          amount: 2,
          fromAddress: 'liqPool',
          toAddress: 'winner'
        }
      });

      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          stateHash: 's4',
          relayBlob
        }, 503)
      ).rejects.toThrow(/state-root gate/i);
    } finally {
      if (typeof prev === 'undefined') delete process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
      else process.env.TL_ORACLE_REQUIRE_STATE_ROOT = prev;
    }
  });

  test('state-root gate accepts anchored settlement when required', async () => {
    const prev = process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
    process.env.TL_ORACLE_REQUIRE_STATE_ROOT = '1';
    try {
      const { Logic, updates } = loadHarness();
      const settlement = {
        mode: 'pnl_sweep',
        propertyId: 5,
        amount: 2,
        fromAddress: 'liqPool',
        toAddress: 'winner'
      };
      const anchored = mkAnchoredPayload(settlement, { dlcRef: '', stateHash: 's5' });
      const relayBlob = JSON.stringify({
        eventId: 'ev5',
        outcome: 'SETTLED',
        outcomeIndex: 0,
        stateHash: 's5',
        timestamp: 5,
        payloadHash: anchored.payloadHash,
        balancePayloadB64: anchored.balancePayloadB64,
        settlement: {
          ...settlement,
          stateRoot: anchored.payloadDoc.stateRoot,
          transitionHash: anchored.transitionHash
        }
      });

      await Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 's5',
        relayBlob
      }, 504);

      expect(updates).toEqual([
        ['liqPool', 5, -2, 0, 0, 0, 'oraclePnlSweep', 504],
        ['winner', 5, 2, 0, 0, 0, 'oraclePnlSweep', 504]
      ]);
    } finally {
      if (typeof prev === 'undefined') delete process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
      else process.env.TL_ORACLE_REQUIRE_STATE_ROOT = prev;
    }
  });

  test('binohash scheme rejects bad inclusion proof', async () => {
    const prevReq = process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
    const prevScheme = process.env.TL_ORACLE_STATE_COMMIT_SCHEME;
    process.env.TL_ORACLE_REQUIRE_STATE_ROOT = '1';
    process.env.TL_ORACLE_STATE_COMMIT_SCHEME = 'binohash';
    try {
      const { Logic } = loadHarness();
      const settlement = {
        mode: 'pnl_sweep',
        propertyId: 5,
        amount: 2,
        fromAddress: 'liqPool',
        toAddress: 'winner'
      };
      const anchored = mkAnchoredPayload(settlement, { dlcRef: '', stateHash: 's6' });
      const wrong = BinohashAdapter.buildProofFromTransitionHashes(['a'.repeat(64)], 0);
      const payloadDoc = {
        stateRoot: wrong.root,
        binohash: { root: wrong.root },
        transitions: [anchored.transitionHash]
      };
      const balancePayloadB64 = Buffer.from(JSON.stringify(payloadDoc), 'utf8').toString('base64');
      const payloadHash = crypto.createHash('sha256').update(Buffer.from(balancePayloadB64, 'base64')).digest('hex');
      const relayBlob = JSON.stringify({
        eventId: 'ev6',
        outcome: 'SETTLED',
        outcomeIndex: 0,
        stateHash: 's6',
        timestamp: 6,
        payloadHash,
        balancePayloadB64,
        settlement: {
          ...settlement,
          stateRoot: wrong.root,
          transitionHash: anchored.transitionHash,
          binoProof: wrong.proof
        }
      });

      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          stateHash: 's6',
          relayBlob
        }, 505)
      ).rejects.toThrow(/binohash/i);
    } finally {
      if (typeof prevReq === 'undefined') delete process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
      else process.env.TL_ORACLE_REQUIRE_STATE_ROOT = prevReq;
      if (typeof prevScheme === 'undefined') delete process.env.TL_ORACLE_STATE_COMMIT_SCHEME;
      else process.env.TL_ORACLE_STATE_COMMIT_SCHEME = prevScheme;
    }
  });

  test('binohash scheme accepts valid inclusion proof', async () => {
    const prevReq = process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
    const prevScheme = process.env.TL_ORACLE_STATE_COMMIT_SCHEME;
    process.env.TL_ORACLE_REQUIRE_STATE_ROOT = '1';
    process.env.TL_ORACLE_STATE_COMMIT_SCHEME = 'binohash';
    try {
      const { Logic, updates } = loadHarness();
      const settlement = {
        mode: 'pnl_sweep',
        propertyId: 5,
        amount: 2,
        fromAddress: 'liqPool',
        toAddress: 'winner'
      };
      const anchored = mkAnchoredPayload(settlement, { dlcRef: '', stateHash: 's7' });
      const proofPack = BinohashAdapter.buildProofFromTransitionHashes([anchored.transitionHash], 0);

      const payloadDoc = {
        stateRoot: proofPack.root,
        binohash: { root: proofPack.root },
        transitions: [anchored.transitionHash]
      };
      const balancePayloadB64 = Buffer.from(JSON.stringify(payloadDoc), 'utf8').toString('base64');
      const payloadHash = crypto.createHash('sha256').update(Buffer.from(balancePayloadB64, 'base64')).digest('hex');

      const relayBlob = JSON.stringify({
        eventId: 'ev7',
        outcome: 'SETTLED',
        outcomeIndex: 0,
        stateHash: 's7',
        timestamp: 7,
        payloadHash,
        balancePayloadB64,
        settlement: {
          ...settlement,
          stateRoot: proofPack.root,
          transitionHash: anchored.transitionHash,
          binoProof: proofPack.proof
        }
      });

      await Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 's7',
        relayBlob
      }, 506);

      expect(updates).toEqual([
        ['liqPool', 5, -2, 0, 0, 0, 'oraclePnlSweep', 506],
        ['winner', 5, 2, 0, 0, 0, 'oraclePnlSweep', 506]
      ]);
    } finally {
      if (typeof prevReq === 'undefined') delete process.env.TL_ORACLE_REQUIRE_STATE_ROOT;
      else process.env.TL_ORACLE_REQUIRE_STATE_ROOT = prevReq;
      if (typeof prevScheme === 'undefined') delete process.env.TL_ORACLE_STATE_COMMIT_SCHEME;
      else process.env.TL_ORACLE_STATE_COMMIT_SCHEME = prevScheme;
    }
  });
});
