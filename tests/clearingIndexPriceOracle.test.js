describe('Clearing.getIndexPrice oracle mode', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('accepts numeric oracle prices from OracleList.getOraclePrice', async () => {
    jest.doMock('../src/contractRegistry.js', () => ({
      getContractInfo: jest.fn(async () => ({
        native: false,
        underlyingOracleId: 2
      }))
    }));

    jest.doMock('../src/oracle.js', () => ({
      getOraclePrice: jest.fn(async () => 123.45)
    }));

    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async () => ({ findAsync: jest.fn(async () => []) }))
    }));

    const Clearing = require('../src/clearing');
    const px = await Clearing.getIndexPrice(3, 999999);
    expect(px).toBe(123.45);
  });
});

