describe('Scaling settlement execution paths', () => {
  function loadLogic({
    channel = { A: { 1: 50 }, B: { 1: 30 } },
    scalingDoc = null
  } = {}) {
    jest.resetModules();

    const state = {
      channel: JSON.parse(JSON.stringify(channel)),
      scalingDoc: scalingDoc ? JSON.parse(JSON.stringify(scalingDoc)) : null
    };

    const scalingApi = {
      processKeepAlive: jest.fn(async () => {}),
      processClosePosition: jest.fn(async () => {}),
      processNetSettle: jest.fn(async () => {}),
      recordSettlement: jest.fn(async () => {})
    };

    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({})
    }));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/validity.js', () => ({}));
    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/txEncoder.js', () => ({}));
    jest.doMock('../src/types.js', () => ({}));
    jest.doMock('../src/txDecoder.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));

    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: scalingApi,
      SettleType: { KEEP_ALIVE: 0, CLOSE_POSITION: 1, NET_SETTLE: 2, KING_SETTLE: 3 },
      SettleStatus: { PENDING: 'pending', LIVE: 'live', NEUTRALIZED: 'neutralized', SWEPT: 'swept' }
    }));

    jest.doMock('../src/channels.js', () => ({
      getChannel: jest.fn(async () => state.channel),
      getCommitAddresses: jest.fn(async () => ({ commitAddressA: 'A1', commitAddressB: 'B1' })),
      updateChannel: jest.fn(async (_channelAddress, updated) => {
        state.channel = JSON.parse(JSON.stringify(updated));
      })
    }));

    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async () => ({
        findOneAsync: jest.fn(async () => state.scalingDoc),
        updateAsync: jest.fn(async (_query, update) => {
          if (update && update.$push) {
            state.scalingDoc = state.scalingDoc || { _id: 'channel-1' };
            for (const [k, v] of Object.entries(update.$push)) {
              if (!Array.isArray(state.scalingDoc[k])) state.scalingDoc[k] = [];
              state.scalingDoc[k].push(v);
            }
            return;
          }
          state.scalingDoc = JSON.parse(JSON.stringify(update));
        })
      }))
    }));

    const Logic = require('../src/logic.js');
    return { Logic, state, scalingApi };
  }

  test('batchSettlement sweeps in-range L2 entries and transfers channel balances', async () => {
    const { Logic, state } = loadLogic({
      channel: { A: { 1: 25 }, B: { 1: 15 } },
      scalingDoc: {
        _id: 'channel-1',
        trades: [{ block: 100, status: 'live' }, { block: 50, status: 'live' }],
        keepAlives: [{ block: 100, status: 'pending' }],
        settlements: [{ block: 100, status: 'live' }],
        closes: [{ block: 100, status: 'neutralized' }],
        netSettles: [{ block: 100, status: 'pending' }]
      }
    });

    await Logic.batchSettlement({
      senderAddress: 'channel-1',
      blockStart: 90,
      blockEnd: 110,
      propertyId: 1,
      netAmount: 5,
      aPaysBDirection: true,
      channelRoot: 'utxo-root',
      totalContracts: 2,
      neutralizedCount: 3,
      block: 120,
      txid: 'king-1'
    });

    expect(state.channel.A[1]).toBe(20);
    expect(state.channel.B[1]).toBe(20);
    expect(state.scalingDoc.kingSettlements).toHaveLength(1);
    expect(state.scalingDoc.kingSettlements[0].txid).toBe('king-1');

    const sweptStatuses = [
      state.scalingDoc.trades[0].status,
      state.scalingDoc.keepAlives[0].status,
      state.scalingDoc.settlements[0].status,
      state.scalingDoc.netSettles[0].status
    ];
    sweptStatuses.forEach((s) => expect(s).toBe('swept'));
    expect(state.scalingDoc.trades[1].status).toBe('live');
  });

  test('settleChannelPNL settleType=3 routes to batchSettlement and records settlement', async () => {
    const { Logic, scalingApi } = loadLogic({
      channel: { A: { 1: 60 }, B: { 1: 30 } },
      scalingDoc: { _id: 'channel-1', trades: [], keepAlives: [], settlements: [], closes: [], netSettles: [] }
    });

    await Logic.settleChannelPNL(
      'channel-1',
      {
        settleType: 3,
        blockStart: 200,
        blockEnd: 210,
        propertyId: 1,
        netAmount: 6,
        aPaysBDirection: false,
        channelRoot: 'root-2'
      },
      210,
      'settle-king-via-23'
    );

    expect(scalingApi.recordSettlement).toHaveBeenCalledWith('channel-1', 'settle-king-via-23', 3, 210);
  });
});
