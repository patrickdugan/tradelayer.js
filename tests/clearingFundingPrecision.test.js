describe('Clearing funding precision', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function loadClearing({
    contractRegistry = {},
    volumeIndex = {},
    oracle = {}
  } = {}) {
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => contractRegistry);
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/insurance.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => volumeIndex);
    jest.doMock('../src/oracle.js', () => oracle);
    jest.doMock('../src/iou.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    return require('../src/clearing');
  }

  test('clampFundingRate returns BigNumber with exact threshold arithmetic', () => {
    const Clearing = loadClearing();
    const nearZero = Clearing.clampFundingRate(4.99);
    const slight = Clearing.clampFundingRate(5.01);
    const neg = Clearing.clampFundingRate(-5.25);

    expect(nearZero.toString()).toBe('0');
    expect(slight.toString()).toBe('0.01');
    expect(neg.toString()).toBe('-0.25');
  });

  test('calculateFundingRate caps by absolute bound with stable decimal math', async () => {
    const Clearing = loadClearing({
      contractRegistry: {
        getContractInfo: jest.fn(async () => ({
          native: true,
          notionalPropertyId: 1,
          collateralPropertyId: 2
        }))
      },
      volumeIndex: {
        getVWAP: jest.fn(async () => 100)
      },
      oracle: {
        getTWAP: jest.fn(async () => 100)
      }
    });

    jest.spyOn(Clearing, 'getIndexPrice').mockResolvedValue(120);

    const rate = await Clearing.calculateFundingRate(3, 12345);
    expect(rate).toBe(12.5);
  });
});
