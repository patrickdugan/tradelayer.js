describe('Option clearing adjustments', () => {
  test('adds naked maintenance for short calls at 10 percent of spot', async () => {
    jest.resetModules();

    const optionsBag = {
      '3-2000-C-120': { contracts: -2, avgPrice: 1.1, margin: 0 }
    };

    jest.doMock('../src/marginMap.js', () => ({
      getInstance: jest.fn(async () => ({
        margins: new Map([
          ['writer1', { options: optionsBag }]
        ])
      }))
    }));

    jest.doMock('../src/contractRegistry.js', () => ({
      getContractInfo: jest.fn(async () => ({ volAnnual: 0 }))
    }));

    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/insurance.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/iou.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));

    const Clearing = require('../src/clearing.js');
    const clearing = new Clearing();
    const out = await clearing.computeOptionAdjustments('3', 'writer1', 150, 1000, 144);

    expect(out.maintNaked).toBe(30);
    expect(out.premiumMTM).toBe(-60);
    expect(out.intrinsicNet).toBe(-60);
  });
});
