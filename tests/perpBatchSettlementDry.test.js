describe('perp batch settlement dry flow', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('macroBatch settles each referenced trade id in a single settlement call', async () => {
    const scaling = {
      neutralizeSettlement: jest.fn(async () => {}),
      isTradePublished: jest.fn(async () => ({ status: 'liveContract', params: { contractId: 1 } })),
      settlementLimbo: jest.fn(async () => {}),
      generateOffset: jest.fn((params) => ({ params })),
      queryPriorSettlements: jest.fn(async () => ({ markPrice: 100 })),
      settlePNL: jest.fn(async () => ({ ok: true }))
    };

    jest.doMock('../src/scaling.js', () => scaling);
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/activation.js', () => ({ getInstance: () => ({}) }));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/validity.js', () => ({}));
    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/property.js', () => ({ getInstance: () => ({}) }));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/txEncoder.js', () => ({}));
    jest.doMock('../src/txDecoder.js', () => ({}));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));

    const Logic = require('../src/logic.js');
    jest.spyOn(Logic, 'typeSwitch').mockResolvedValue(undefined);

    const txIds = Array.from({ length: 20 }, (_, i) => `tx${i + 1}`);
    await Logic.settleChannelPNL(
      'channel-1',
      {
        txidNeutralized1: txIds.join(';'),
        markPrice: 101.25,
        close: false,
        macroBatch: true
      },
      1000,
      'settle-1'
    );

    expect(scaling.isTradePublished).toHaveBeenCalledTimes(20);
    expect(scaling.settlePNL).toHaveBeenCalledTimes(20);
  });
});
