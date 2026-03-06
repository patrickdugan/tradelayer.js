describe('tx30 staged stake -> relay -> fraud -> slash payout', () => {
  function loadLogicHarness() {
    jest.resetModules();
    const ledger = new Map();
    const stakes = new Map();
    const relays = [];
    const transitions = [];

    const key = (a, p) => `${a}:${p}`;
    const addBal = (a, p, delta) => {
      const k = key(a, p);
      ledger.set(k, (ledger.get(k) || 0) + Number(delta || 0));
    };

    jest.doMock('../src/tally.js', () => ({
      updateBalance: jest.fn(async (addr, pid, availDelta) => {
        addBal(addr, pid, availDelta);
      })
    }));
    jest.doMock('../src/oracle.js', () => ({
      recordStake: jest.fn(async (oracleId, stakerAddress, stakedPropertyId, amount) => {
        const k = `${oracleId}:${stakerAddress}:${stakedPropertyId}`;
        stakes.set(k, (stakes.get(k) || 0) + Number(amount || 0));
        return { amount: stakes.get(k) };
      }),
      applyFraudProof: jest.fn(async (oracleId, accusedAddress, challengerAddress, slashAmount) => {
        const maybe = [...stakes.keys()].find(k => k.startsWith(`${oracleId}:${accusedAddress}:`));
        if (!maybe) return { slashed: 0 };
        const curr = stakes.get(maybe) || 0;
        const slashed = Math.min(curr, Number(slashAmount || 0));
        stakes.set(maybe, curr - slashed);
        return { slashed, challengerAddress };
      }),
      relayTradeLayerState: jest.fn(async (oracleId, senderAddress, relayType, stateHash, dlcRef) => {
        relays.push({ oracleId, senderAddress, relayType, stateHash, dlcRef });
      })
    }));
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        transitionContract: jest.fn(async (contractId, state) => {
          transitions.push({ contractId, state });
          return { contractId, state };
        })
      }
    }));

    // Quiet dependencies unrelated to this flow.
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/activation.js', () => ({ getInstance: () => ({}) }));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));
    jest.doMock('../src/property.js', () => ({ isManagedAndAdmin: jest.fn(async () => true), getPropertyData: jest.fn(async () => ({ type: 2 })), getInstance: () => ({ grantTokens: jest.fn(), redeemTokens: jest.fn() }) }));
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
    return { Logic, ledger, stakes, relays, transitions };
  }

  test('full stage lifecycle executes expected accounting and transitions', async () => {
    const { Logic, ledger, stakes, relays, transitions } = loadLogicHarness();

    await Logic.processStakeFraudProof('stakerA', {
      action: 0,
      oracleId: 5,
      stakedPropertyId: 9,
      amount: 10
    }, 101);

    await Logic.processStakeFraudProof('oracleAdmin', {
      action: 2,
      oracleId: 5,
      relayType: 1,
      stateHash: 'relay-state-1',
      dlcRef: 'ct-777',
      settlementState: 'SETTLED',
      relayBlob: ''
    }, 102);

    await Logic.processStakeFraudProof('challengerB', {
      action: 1,
      oracleId: 5,
      accusedAddress: 'stakerA',
      amount: 3,
      evidenceHash: 'fraud-proof-hash',
      stakedPropertyId: 9
    }, 103);

    expect(ledger.get('stakerA:9')).toBe(-10);
    expect(stakes.get('5:stakerA:9')).toBe(7);
    expect(relays).toHaveLength(1);
    expect(relays[0].dlcRef).toBe('ct-777');
    expect(transitions).toEqual([{ contractId: 'ct-777', state: 'SETTLED' }]);
    expect(ledger.get('challengerB:9')).toBe(3);
  });
});

