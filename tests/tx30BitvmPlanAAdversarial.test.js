describe('tx30 Plan A BitVM cache + adversarial payout stress', () => {
  function loadHarness() {
    jest.resetModules();

    const ledger = new Map();
    const updates = [];
    const proceduralDocs = new Map();
    const bundleVerify = jest.fn(async (expectedBundleHash, explicitPath) => {
      const normalized = String(expectedBundleHash || '').trim().toLowerCase();
      if (!normalized) {
        return { valid: false, reason: 'Missing bundleHash' };
      }
      return {
        valid: true,
        bundleHash: normalized,
        bundlePath: explicitPath || 'mock-bundle-path'
      };
    });

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
    jest.doMock('../src/bitvmBundle.js', () => ({
      verifyBundleHash: bundleVerify,
      computeBundleHash: jest.fn(() => 'mock-hash')
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
    return { Logic, ledger, updates, setBal, getBal, bitvmDocById, firstBitvmDoc, bundleVerify };
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

  test('bundle gate: requires bundle hash when TL_BITVM_REQUIRE_BUNDLE=1', async () => {
    const prev = process.env.TL_BITVM_REQUIRE_BUNDLE;
    process.env.TL_BITVM_REQUIRE_BUNDLE = '1';
    try {
      const { Logic, setBal } = loadHarness();
      setBal('loser', 5, 100);

      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          dlcRef: 'ct-bundle-missing',
          stateHash: 'state-bundle-missing',
          relayBlob: relayBlob({
            mode: 'bitvm_cache',
            propertyId: 5,
            amount: 12,
            fromAddress: 'loser',
            toAddress: 'winner',
            cacheAddress: 'BITVM_CACHE::ct-bundle-missing',
            challengeBlocks: 1
          })
        }, 1200)
      ).rejects.toThrow(/bundle verification failed/i);
    } finally {
      if (typeof prev === 'undefined') delete process.env.TL_BITVM_REQUIRE_BUNDLE;
      else process.env.TL_BITVM_REQUIRE_BUNDLE = prev;
    }
  });

  test('bundle gate: rejects invalid bundle hash verification', async () => {
    const prev = process.env.TL_BITVM_REQUIRE_BUNDLE;
    process.env.TL_BITVM_REQUIRE_BUNDLE = '1';
    try {
      const { Logic, setBal, bundleVerify } = loadHarness();
      setBal('loser', 5, 100);
      bundleVerify.mockResolvedValueOnce({ valid: false, reason: 'Provided bundleHash mismatch' });

      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          dlcRef: 'ct-bundle-bad',
          stateHash: 'state-bundle-bad',
          relayBlob: relayBlob({
            mode: 'bitvm_cache',
            propertyId: 5,
            amount: 12,
            fromAddress: 'loser',
            toAddress: 'winner',
            cacheAddress: 'BITVM_CACHE::ct-bundle-bad',
            challengeBlocks: 1,
            bundleHash: 'bad-bundle-hash'
          })
        }, 1201)
      ).rejects.toThrow(/bundle verification failed/i);
    } finally {
      if (typeof prev === 'undefined') delete process.env.TL_BITVM_REQUIRE_BUNDLE;
      else process.env.TL_BITVM_REQUIRE_BUNDLE = prev;
    }
  });

  test('bundle gate: accepts valid bundle hash verification', async () => {
    const prev = process.env.TL_BITVM_REQUIRE_BUNDLE;
    process.env.TL_BITVM_REQUIRE_BUNDLE = '1';
    try {
      const { Logic, setBal, firstBitvmDoc, getBal, bundleVerify } = loadHarness();
      setBal('loser', 5, 100);

      await Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        dlcRef: 'ct-bundle-good',
        stateHash: 'state-bundle-good',
        relayBlob: relayBlob({
          mode: 'bitvm_cache',
          propertyId: 5,
          amount: 12,
          fromAddress: 'loser',
          toAddress: 'winner',
          cacheAddress: 'BITVM_CACHE::ct-bundle-good',
          challengeBlocks: 1,
          bundleHash: 'GOOD-BUNDLE-HASH',
          bundlePath: 'C:\\temp\\bundle.json'
        })
      }, 1202);

      expect(bundleVerify).toHaveBeenCalledWith('GOOD-BUNDLE-HASH', 'C:\\temp\\bundle.json');
      const cache = firstBitvmDoc();
      expect(cache).toBeTruthy();
      expect(getBal('loser', 5)).toBe(88);
      expect(getBal('BITVM_CACHE::ct-bundle-good', 5)).toBe(12);
    } finally {
      if (typeof prev === 'undefined') delete process.env.TL_BITVM_REQUIRE_BUNDLE;
      else process.env.TL_BITVM_REQUIRE_BUNDLE = prev;
    }
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

  test('resolve rejects mismatched resolver identity', async () => {
    const { Logic, setBal, firstBitvmDoc } = loadHarness();
    setBal('loser', 5, 30);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-7',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 6,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-7',
        challengeBlocks: 0
      })
    }, 700);

    const cache = firstBitvmDoc();
    await expect(
      Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 'state-7',
        relayBlob: relayBlob({
          mode: 'bitvm_resolve',
          cacheId: cache.cacheId,
          verdict: 'reject',
          resolverAddress: 'different-resolver',
          reason: 'identity mismatch attempt'
        })
      }, 701)
    ).rejects.toThrow(/sender must match resolverAddress/i);
  });

  test('economics: uphold slashes cache bond to challenger and returns challenge bond', async () => {
    const { Logic, setBal, getBal, firstBitvmDoc } = loadHarness();
    setBal('oracleAdmin', 5, 20);
    setBal('loser', 5, 30);
    setBal('challenger', 5, 10);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-8',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 6,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-8',
        challengeBlocks: 0,
        cacheBondAmount: 4,
        cacheBondPropertyId: 5
      })
    }, 800);

    const cache = firstBitvmDoc();
    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-8',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: cache.cacheId,
        challengerAddress: 'challenger',
        challengeBondAmount: 3,
        challengeBondPropertyId: 5
      })
    }, 801);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-8',
      relayBlob: relayBlob({
        mode: 'bitvm_resolve',
        cacheId: cache.cacheId,
        verdict: 'uphold',
        resolverAddress: 'oracleAdmin'
      })
    }, 802);

    expect(getBal('loser', 5)).toBe(30);
    expect(getBal('oracleAdmin', 5)).toBe(16); // 20 - 4 cache bond (not returned)
    expect(getBal('challenger', 5)).toBe(14); // 10 - 3 + 3 + 4
    expect(getBal('BITVM_BOND_CACHE::' + cache.cacheId, 5)).toBe(0);
    expect(getBal('BITVM_BOND_CHALLENGE::' + cache.cacheId, 5)).toBe(0);
  });

  test('economics: reject returns cache bond and slashes challenge bond to opener', async () => {
    const { Logic, setBal, getBal, firstBitvmDoc } = loadHarness();
    setBal('oracleAdmin', 5, 20);
    setBal('loser', 5, 30);
    setBal('challenger', 5, 10);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-9',
      relayBlob: relayBlob({
        mode: 'bitvm_cache',
        propertyId: 5,
        amount: 5,
        fromAddress: 'loser',
        toAddress: 'winner',
        cacheAddress: 'BITVM_CACHE::ct-9',
        challengeBlocks: 0,
        cacheBondAmount: 4,
        cacheBondPropertyId: 5
      })
    }, 900);

    const cache = firstBitvmDoc();
    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-9',
      relayBlob: relayBlob({
        mode: 'bitvm_challenge',
        cacheId: cache.cacheId,
        challengerAddress: 'challenger',
        challengeBondAmount: 3,
        challengeBondPropertyId: 5
      })
    }, 901);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 1,
      relayType: 1,
      stateHash: 'state-9',
      relayBlob: relayBlob({
        mode: 'bitvm_resolve',
        cacheId: cache.cacheId,
        verdict: 'reject',
        resolverAddress: 'oracleAdmin'
      })
    }, 902);

    expect(getBal('oracleAdmin', 5)).toBe(23); // 20 -4 +4 +3
    expect(getBal('challenger', 5)).toBe(7); // 10 -3 (slashed)
    expect(getBal('BITVM_BOND_CACHE::' + cache.cacheId, 5)).toBe(0);
    expect(getBal('BITVM_BOND_CHALLENGE::' + cache.cacheId, 5)).toBe(0);
  });

  test('risk caps: pending escrow cap blocks excess cache opens', async () => {
    const prevPending = process.env.TL_BITVM_MAX_PENDING_ESCROW;
    const prevWindow = process.env.TL_BITVM_SCHED_WINDOW_BLOCKS;
    process.env.TL_BITVM_MAX_PENDING_ESCROW = '20';
    process.env.TL_BITVM_SCHED_WINDOW_BLOCKS = '50';
    try {
      const { Logic, setBal } = loadHarness();
      setBal('loser', 5, 200);

      await Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        dlcRef: 'cap-a',
        stateHash: 'cap-a',
        relayBlob: relayBlob({
          mode: 'bitvm_cache',
          propertyId: 5,
          amount: 11,
          fromAddress: 'loser',
          toAddress: 'winner',
          cacheAddress: 'BITVM_CACHE::cap-a',
          challengeBlocks: 5
        })
      }, 1000);

      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          dlcRef: 'cap-b',
          stateHash: 'cap-b',
          relayBlob: relayBlob({
            mode: 'bitvm_cache',
            propertyId: 5,
            amount: 10,
            fromAddress: 'loser',
            toAddress: 'winner',
            cacheAddress: 'BITVM_CACHE::cap-b',
            challengeBlocks: 5
          })
        }, 1001)
      ).rejects.toThrow(/escrow cap exceeded/i);
    } finally {
      if (typeof prevPending === 'undefined') delete process.env.TL_BITVM_MAX_PENDING_ESCROW;
      else process.env.TL_BITVM_MAX_PENDING_ESCROW = prevPending;
      if (typeof prevWindow === 'undefined') delete process.env.TL_BITVM_SCHED_WINDOW_BLOCKS;
      else process.env.TL_BITVM_SCHED_WINDOW_BLOCKS = prevWindow;
    }
  });

  test('risk caps: sweep window cap throttles oversized pnl_sweep', async () => {
    const prevSweep = process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW;
    const prevWindow = process.env.TL_BITVM_SCHED_WINDOW_BLOCKS;
    process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW = '5';
    process.env.TL_BITVM_SCHED_WINDOW_BLOCKS = '100';
    try {
      const { Logic, setBal } = loadHarness();
      setBal('pool', 5, 100);

      await Logic.processStakeFraudProof('oracleAdmin', {
        action: 2,
        oracleId: 1,
        relayType: 1,
        stateHash: 'sw-1',
        relayBlob: relayBlob({
          mode: 'pnl_sweep',
          propertyId: 5,
          amount: 3,
          fromAddress: 'pool',
          toAddress: 'winner'
        })
      }, 1100);

      await expect(
        Logic.processStakeFraudProof('oracleAdmin', {
          action: 2,
          oracleId: 1,
          relayType: 1,
          stateHash: 'sw-2',
          relayBlob: relayBlob({
            mode: 'pnl_sweep',
            propertyId: 5,
            amount: 3,
            fromAddress: 'pool',
            toAddress: 'winner'
          })
        }, 1101)
      ).rejects.toThrow(/sweep window cap exceeded/i);
    } finally {
      if (typeof prevSweep === 'undefined') delete process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW;
      else process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW = prevSweep;
      if (typeof prevWindow === 'undefined') delete process.env.TL_BITVM_SCHED_WINDOW_BLOCKS;
      else process.env.TL_BITVM_SCHED_WINDOW_BLOCKS = prevWindow;
    }
  });
});
