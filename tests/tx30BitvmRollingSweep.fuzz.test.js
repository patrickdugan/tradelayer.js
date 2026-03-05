describe('tx30 rolling/sweep risk scheduler fuzz', () => {
  function loadHarness() {
    jest.resetModules();

    const ledger = new Map();
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
      verifyBundleHash: jest.fn(async () => ({ valid: true, bundleHash: 'ok', bundlePath: 'mock' })),
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
    return { Logic, setBal, proceduralDocs };
  }

  function relayBlob(settlement) {
    return JSON.stringify({
      eventId: 'ev-fuzz',
      outcome: 'SETTLED',
      outcomeIndex: 0,
      stateHash: 'state-fuzz',
      timestamp: Date.now(),
      settlement
    });
  }

  function rng(seed = 0x12345678) {
    let s = seed >>> 0;
    return () => {
      s ^= (s << 13) >>> 0;
      s ^= (s >>> 17) >>> 0;
      s ^= (s << 5) >>> 0;
      return (s >>> 0) / 0xffffffff;
    };
  }

  test('fuzz invariant: scheduler caps keep escrow bounded', async () => {
    const prev = {
      pending: process.env.TL_BITVM_MAX_PENDING_ESCROW,
      sweep: process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW,
      deposit: process.env.TL_BITVM_MAX_DEPOSIT_PER_WINDOW,
      window: process.env.TL_BITVM_SCHED_WINDOW_BLOCKS
    };
    process.env.TL_BITVM_MAX_PENDING_ESCROW = '25';
    process.env.TL_BITVM_MAX_DEPOSIT_PER_WINDOW = '30';
    process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW = '18';
    process.env.TL_BITVM_SCHED_WINDOW_BLOCKS = '25';

    try {
      const { Logic, setBal, proceduralDocs } = loadHarness();
      setBal('loser', 5, 1000);
      setBal('pool', 5, 1000);

      const rand = rng(0xdecafbad);
      let block = 2000;
      let capErrors = 0;

      for (let i = 0; i < 180; i++) {
        const roll = rand();
        block += 1;
        if (roll < 0.55) {
          const amount = 1 + Math.floor(rand() * 8);
          try {
            await Logic.processStakeFraudProof('oracleAdmin', {
              action: 2,
              oracleId: 1,
              relayType: 1,
              dlcRef: `f-${i}`,
              stateHash: `sf-${i}`,
              relayBlob: relayBlob({
                mode: 'bitvm_cache',
                propertyId: 5,
                amount,
                fromAddress: 'loser',
                toAddress: 'winner',
                cacheAddress: `BITVM_CACHE::f-${i}`,
                challengeBlocks: 0
              })
            }, block);
          } catch (e) {
            if (/cap exceeded/i.test(String(e?.message || e))) capErrors++;
          }
        } else if (roll < 0.82) {
          const pending = [...proceduralDocs.values()].filter((d) => d && d.type === 'bitvmCache' && d.status === 'PENDING');
          if (pending.length > 0) {
            const pick = pending[Math.floor(rand() * pending.length)];
            try {
              await Logic.processStakeFraudProof('oracleAdmin', {
                action: 2,
                oracleId: 1,
                relayType: 1,
                dlcRef: pick.dlcRef || '',
                stateHash: `sp-${i}`,
                relayBlob: relayBlob({
                  mode: 'bitvm_payout',
                  cacheId: pick.cacheId,
                  propertyId: pick.propertyId,
                  amount: pick.amount,
                  toAddress: pick.toAddress
                })
              }, block);
            } catch (_) {
              // ignore, fuzz path may select docs that transitioned in same iteration sequence
            }
          }
        } else {
          const amount = 1 + Math.floor(rand() * 6);
          try {
            await Logic.processStakeFraudProof('oracleAdmin', {
              action: 2,
              oracleId: 1,
              relayType: 1,
              stateHash: `ss-${i}`,
              relayBlob: relayBlob({
                mode: 'pnl_sweep',
                propertyId: 5,
                amount,
                fromAddress: 'pool',
                toAddress: 'winner'
              })
            }, block);
          } catch (_) {
            // sweep window throttling expected intermittently
          }
        }
      }

      const globalRiskDoc = [...proceduralDocs.values()].find((d) => d && d._id === 'bitvm-risk-escrow-global-5');
      const pendingAmount = Number(globalRiskDoc?.pendingAmount || 0);
      expect(pendingAmount).toBeGreaterThanOrEqual(0);
      expect(pendingAmount).toBeLessThanOrEqual(25);
      expect(capErrors).toBeGreaterThan(0);
    } finally {
      if (typeof prev.pending === 'undefined') delete process.env.TL_BITVM_MAX_PENDING_ESCROW;
      else process.env.TL_BITVM_MAX_PENDING_ESCROW = prev.pending;
      if (typeof prev.sweep === 'undefined') delete process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW;
      else process.env.TL_BITVM_MAX_SWEEP_PER_WINDOW = prev.sweep;
      if (typeof prev.deposit === 'undefined') delete process.env.TL_BITVM_MAX_DEPOSIT_PER_WINDOW;
      else process.env.TL_BITVM_MAX_DEPOSIT_PER_WINDOW = prev.deposit;
      if (typeof prev.window === 'undefined') delete process.env.TL_BITVM_SCHED_WINDOW_BLOCKS;
      else process.env.TL_BITVM_SCHED_WINDOW_BLOCKS = prev.window;
    }
  });
});

