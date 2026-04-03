describe('tx14 oracle delta publish', () => {
  function loadHarness() {
    jest.resetModules();

    const publishCalls = [];
    jest.doMock('../src/oracle.js', () => ({
      publishData: jest.fn(async (...args) => {
        publishCalls.push(args);
      }),
      getInstance: () => ({ oracles: new Map() })
    }));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/activation.js', () => ({ getInstance: () => ({}) }));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({ ScalingL2: {} }));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/validity.js', () => ({}));
    jest.doMock('../src/types.js', () => ({}));
    jest.doMock('../src/txEncoder.js', () => ({}));
    jest.doMock('../src/txDecoder.js', () => ({}));

    const Logic = require('../src/logic.js');
    return { Logic, publishCalls };
  }

  test('publishOracleData forwards delta payloads as structured oracle data', async () => {
    const { Logic, publishCalls } = loadHarness();

    await Logic.publishOracleData({
      oracleId: 12,
      kind: 'delta',
      propertyId: 380,
      payloadHash: 'a'.repeat(64),
      deltaRef: 'delta-001',
      block: 700
    });

    expect(publishCalls).toEqual([
      [12, expect.objectContaining({
        kind: 'delta',
        propertyId: 380,
        payloadHash: 'a'.repeat(64),
        deltaRef: 'delta-001'
      }), 700]
    ]);
  });

  test('publishOracleData forwards daily blob payloads as structured oracle data', async () => {
    const { Logic, publishCalls } = loadHarness();

    await Logic.publishOracleData({
      oracleId: 12,
      kind: 'daily',
      propertyId: 380,
      windowStartBlock: 100,
      windowEndBlock: 199,
      payloadHash: 'b'.repeat(64),
      blobRef: 'blob-001',
      block: 700
    });

    expect(publishCalls).toEqual([
      [12, expect.objectContaining({
        kind: 'daily',
        propertyId: 380,
        windowStartBlock: 100,
        windowEndBlock: 199,
        payloadHash: 'b'.repeat(64),
        blobRef: 'blob-001'
      }), 700]
    ]);
  });
});
