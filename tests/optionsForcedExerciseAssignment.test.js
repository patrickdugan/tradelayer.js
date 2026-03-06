describe('Options expiry forced assignment', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function setup({
    ticker = '3-100-P-120',
    optionPos = { contracts: -2, avgPrice: 0, margin: 24 },
    expiringTickers = null,
    seriesInfo = {
      collateralPropertyId: 1,
      contracts: {
        unexpired: [
          { id: '3-130', expirationBlock: 130 },
          { id: '3-160', expirationBlock: 160 }
        ]
      }
    }
  } = {}) {
    const recordMarginMapDelta = jest.fn(async () => {});
    const cleanupExpiredTickersUpTo = jest.fn(async () => {});
    const saveMarginMap = jest.fn(async () => {});

    const margins = new Map([
      [
        'addr1',
        {
          address: 'addr1',
          contractId: 3,
          contracts: 0,
          avgPrice: 0,
          margin: 0,
          options: { [ticker]: optionPos }
        }
      ]
    ]);

    jest.doMock('../src/marginMap.js', () => ({
      getInstance: jest.fn(async () => ({
        margins,
        getExpiringTickersUpTo: jest.fn(async () => (Array.isArray(expiringTickers) ? expiringTickers : [ticker])),
        cleanupExpiredTickersUpTo,
        recordMarginMapDelta,
        saveMarginMap
      }))
    }));

    const updateBalance = jest.fn(async () => {});
    jest.doMock('../src/tally.js', () => ({ updateBalance }));

    jest.doMock('../src/contractRegistry.js', () => ({
      getContractInfo: jest.fn(async () => seriesInfo)
    }));

    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async () => ({ findAsync: jest.fn(async () => []) }))
    }));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/insurance.js', () => ({}));
    jest.doMock('../src/iou.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));

    const Clearing = require('../src/clearing');
    return { Clearing, margins, updateBalance, recordMarginMapDelta, cleanupExpiredTickersUpTo };
  }

  test('ITM short put is assigned into nearest future and moves option margin to core', async () => {
    const { Clearing, margins, updateBalance, recordMarginMapDelta } = setup();

    await Clearing.settleOptionExpiries(3, 101, 100, 144, 'tx-assign-1');

    const pos = margins.get('addr1');
    expect(pos.options['3-100-P-120']).toBeUndefined();
    expect(pos.contracts).toBe(2);
    expect(pos.avgPrice).toBe(120);
    expect(pos.margin).toBe(24);

    expect(updateBalance).not.toHaveBeenCalled();
    expect(recordMarginMapDelta).toHaveBeenCalledWith(
      'addr1',
      '3-130',
      2,
      2,
      120,
      0,
      24,
      'optionExpireAssign',
      101
    );
  });

  test('ITM assignment falls back to series id when no future expiry is available', async () => {
    const { Clearing, recordMarginMapDelta } = setup({
      seriesInfo: {
        collateralPropertyId: 1,
        contracts: {
          unexpired: [{ id: '3-90', expirationBlock: 90 }]
        }
      }
    });

    await Clearing.settleOptionExpiries(3, 101, 100, 144, 'tx-assign-2');

    expect(recordMarginMapDelta).toHaveBeenCalledWith(
      'addr1',
      '3',
      2,
      2,
      120,
      0,
      24,
      'optionExpireAssign',
      101
    );
  });

  test('OTM expiry releases option margin via tally and does not open underlying', async () => {
    const { Clearing, margins, updateBalance } = setup({
      ticker: '3-100-C-120',
      optionPos: { contracts: -2, avgPrice: 0, margin: 24 }
    });

    await Clearing.settleOptionExpiries(3, 101, 100, 144, 'tx-otm-1');

    const pos = margins.get('addr1');
    expect(pos.contracts).toBe(0);
    expect(pos.margin).toBe(0);
    expect(pos.options['3-100-C-120']).toBeUndefined();

    expect(updateBalance).toHaveBeenCalledWith(
      'addr1',
      1,
      0,
      0,
      -24,
      0,
      'optionExpire',
      101,
      'tx-otm-1'
    );
  });

  test('fallback ticker scan settles when expiry index is empty after reload', async () => {
    const { Clearing, margins } = setup({
      expiringTickers: []
    });

    await Clearing.settleOptionExpiries(3, 101, 100, 144, 'tx-fallback-1');
    const pos = margins.get('addr1');
    expect(pos.options['3-100-P-120']).toBeUndefined();
    expect(pos.contracts).toBe(2);
  });
});
