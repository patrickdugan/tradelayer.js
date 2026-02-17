describe('tx30 relay settlement modes', () => {
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
});

