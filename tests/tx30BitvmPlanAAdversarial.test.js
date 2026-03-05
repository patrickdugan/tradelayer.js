describe('tx30 Plan A BitVM cache + adversarial payout stress', () => {
  function loadHarness() {
    jest.resetModules();

    const ledger = new Map();
    const updates = [];
    const proceduralDocs = new Map();

    const balKey = (a, p) => `${a}:${p}`;
    const getBal = (a, p) => Number(ledger.get(balKey(a, p)) || 0);
    const setBal = (a, p, v) => ledger.set(balKey(a, p), Number(v || 0));

    const dbStub = {
      findOneAsync: jest.fn(async (query) => proceduralDocs.get(query?._id) || null),
      updateAsync: jest.fn(async (query, update) => {
        const id = query?._id || update?._id;
        const prev = proceduralDocs.get(id) || { _id: id };
        const next = update && update.$set ? { ...prev, ...update.$set } : { ...prev, ...(update || {}) };
        proceduralDocs.set(id, next);
        return 1;
      })
    };

    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async () => dbStub)
    }));

    jest.doMock('../src/tally.js', () => ({
      updateBalance: jest.fn(async (addr, pid, availDelta) => {
        updates.push([addr, pid, availDelta]);
        setBal(addr, pid, getBal(addr, pid) + Number(availDelta || 0));
      }),
      hasSufficientBalance: jest.fn(async (addr, pid, amount) => ({
        hasSufficient: getBal(addr, pid) >= Number(amount || 0),
        reason: 'insufficient'
      }))
    }));

    jest.doMock('../src/property.js', () => ({
      getInstance: () => ({
        redeemTokens: jest.fn(async () => {}),
        grantTokens: jest.fn(async () => {})
      })
    }));

    jest.doMock('../src/oracle.js', () => ({
      relayTradeLayerState: jest.fn(async () => ({}))
    }));

    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        transitionContract: jest.fn(async () => ({}))
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
    jest.doMock('../src/types.js', () => ({}));
    jest.doMock('../src/txEncoder.js', () => ({}));
    jest.doMock('../src/txDecoder.js', () => ({}));
    jest.doMock('../src/validity.js', () => ({}));

    const Logic = require('../src/logic.js');
    const bitvmDocById = (cacheId) => proceduralDocs.get(`bitvm-cache-${cacheId}`);
    const firstBitvmDoc = () => [...proceduralDocs.values()].find((d) => d && d.type === 'bitvmCache');
    return { Logic, ledger, updates, setBal, getBal, bitvmDocById, firstBitvmDoc };
  }

  function relayBlob(settlement) {
    return JSON.stringify({
      eventId: 'ev-bitvm',
      outcome: 'SETTLED',
      outcomeIndex: 0,
      stateHash: 'state-1',
      timestamp: Date.now(),
      settlement
    });
  }

  test('Plan A: cache lock then payout only after challenge window', async () => {
    const { Logic, setBal, getBal, firstBitvmDoc } = loadHarness();
    setBal('loser', 5, 100);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      dlcRef: 'ct-1',
      stateHash: 'state-1',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 12,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-1',
        challengeBlocks: 5,
        bundleHash: 'bundle-1'
      })
    }, 100);

    const cache = firstBitvmDoc();
    expect(cache).toBeTruthy();
    expect(cache.status).toBe('PENDING');
    expect(cache.challengeDeadlineBlock).toBe(105);
    expect(getBal('loser', 5)).toBe(88);
    expect(getBal('BITVM_CACHE::ct-1', 5)).toBe(12);

    await expect(
      Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 'state-1',
        relayBlob: relayBlob({
          mode: 'bitvm_payout',
          cacheId: cache.cacheId,
          propertyId: 5,
          amount: 12,
          toAddress: 'winner'
        })
      }, 103)
    ).rejects.toThrow(/challenge window still open/i);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-1',
      relayBlob: relayBlob({
        mode: 'bitvm_payout',
        cacheId: cache.cacheId,
        propertyId: 5,
        amount: 12,
        toAddress: 'winner'
      })
    }, 106);

    expect(getBal('BITVM_CACHE::ct-1', 5)).toBe(0);
    expect(getBal('winner', 5)).toBe(12);
  });

  test('adversarial scam payout with wrong recipient is rejected', async () => {
    const { Logic, setBal, firstBitvmDoc, getBal } = loadHarness();
    setBal('loser', 5, 50);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      dlcRef: 'ct-2',
      stateHash: 'state-2',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 10,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-2',
        challengeBlocks: 0
      })
    }, 200);

    const cache = firstBitvmDoc();
    await expect(
      Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 'state-2',
        relayBlob: relayBlob({
          mode: 'bitvm_payout',
          cacheId: cache.cacheId,
          propertyId: 5,
          amount: 10,
          toAddress: 'attacker'
        })
      }, 201)
    ).rejects.toThrow(/recipient mismatch/i);

    expect(getBal('BITVM_CACHE::ct-2', 5)).toBe(10);
    expect(getBal('attacker', 5)).toBe(0);
  });

  test('challenge holds payout even after deadline', async () => {
    const { Logic, setBal, firstBitvmDoc, bitvmDocById, getBal } = loadHarness();
    setBal('loser', 5, 90);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-3',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 15,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-3',
        challengeBlocks: 2
      })
    }, 300);

    const cache = firstBitvmDoc();
    await Logic.processStakeFraudProof('challenger', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-3',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: cache.cacheId,
        challengerAddress: 'challenger',
        evidenceHash: 'bad-proof-hash'
      })
    }, 301);

    await expect(
      Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 'state-3',
        relayBlob: relayBlob({
          mode: 'bitvm_payout',
          cacheId: cache.cacheId,
          propertyId: 5,
          amount: 15,
          toAddress: 'winner'
        })
      }, 310)
    ).rejects.toThrow(/challenged; payout blocked/i);

    expect(bitvmDocById(cache.cacheId).status).toBe('CHALLENGED');
    expect(getBal('BITVM_CACHE::ct-3', 5)).toBe(15);
    expect(getBal('winner', 5)).toBe(0);
  });

  test('stress: repeated scam payout attempts after challenge all fail', async () => {
    const { Logic, setBal, firstBitvmDoc, getBal } = loadHarness();
    setBal('loser', 5, 120);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-4',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 25,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-4',
        challengeBlocks: 1
      })
    }, 400);

    const cache = firstBitvmDoc();
    await Logic.processStakeFraudProof('challenger', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-4',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: cache.cacheId,
        challengerAddress: 'challenger',
        evidenceHash: 'fraud-attempt'
      })
    }, 401);

    for (let i = 0; i < 25; i++) {
      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          stateHash: 'state-4',
          relayBlob: relayBlob({
            mode: 'bitvm_payout',
            cacheId: cache.cacheId,
            propertyId: i % 2 === 0 ? 5 : 6,
            amount: i % 2 === 0 ? 25 : 24,
            toAddress: i % 2 === 0 ? 'winner' : 'attacker'
          })
        }, 410 + i)
      ).rejects.toThrow(/challenged; payout blocked/i);
    }

    expect(getBal('BITVM_CACHE::ct-4', 5)).toBe(25);
    expect(getBal('winner', 5)).toBe(0);
    expect(getBal('attacker', 5)).toBe(0);
  });

  test('resolve uphold refunds loser and keeps payout blocked', async () => {
    const { Logic, setBal, firstBitvmDoc, bitvmDocById, getBal } = loadHarness();
    setBal('loser', 5, 75);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-5',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 20,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-5',
        challengeBlocks: 1
      })
    }, 500);

    const cache = firstBitvmDoc();
    await Logic.processStakeFraudProof('challenger', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-5',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: cache.cacheId,
        challengerAddress: 'challenger',
        evidenceHash: 'proven-fraud'
      })
    }, 501);

    await Logic.processStakeFraudProof('resolver', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-5',
      relayBlob: relayBlob({
        mode: 'bitvm_resolve',
        cacheId: cache.cacheId,
        verdict: 'uphold',
        resolverAddress: 'resolver',
        reason: 'fraud confirmed'
      })
    }, 502);

    expect(bitvmDocById(cache.cacheId).status).toBe('RESOLVED_UPHELD');
    expect(getBal('BITVM_CACHE::ct-5', 5)).toBe(0);
    expect(getBal('loser', 5)).toBe(75);
    expect(getBal('winner', 5)).toBe(0);

    await expect(
      Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 'state-5',
        relayBlob: relayBlob({
          mode: 'bitvm_payout',
          cacheId: cache.cacheId,
          propertyId: 5,
          amount: 20,
          toAddress: 'winner'
        })
      }, 510)
    ).rejects.toThrow(/challenge upheld; payout blocked/i);
  });

  test('resolve reject reopens payout path', async () => {
    const { Logic, setBal, firstBitvmDoc, bitvmDocById, getBal } = loadHarness();
    setBal('loser', 5, 40);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-6',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 11,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-6',
        challengeBlocks: 10
      })
    }, 600);

    const cache = firstBitvmDoc();
    await Logic.processStakeFraudProof('challenger', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-6',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: cache.cacheId,
        challengerAddress: 'challenger',
        evidenceHash: 'weak-claim'
      })
    }, 601);

    await Logic.processStakeFraudProof('resolver', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-6',
      relayBlob: relayBlob({
        mode: 'bitvm_resolve',
        cacheId: cache.cacheId,
        verdict: 'reject',
        resolverAddress: 'resolver',
        reason: 'challenge invalid'
      })
    }, 602);

    expect(bitvmDocById(cache.cacheId).status).toBe('PENDING');
    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-6',
      relayBlob: relayBlob({
        mode: 'bitvm_payout',
        cacheId: cache.cacheId,
        propertyId: 5,
        amount: 11,
        toAddress: 'winner'
      })
    }, 603);

    expect(getBal('BITVM_CACHE::ct-6', 5)).toBe(0);
    expect(getBal('winner', 5)).toBe(11);
  });
});
