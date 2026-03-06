describe('Option-protected liquidation bounds', () => {
  function makeMarginMap() {
    jest.resetModules();
    jest.doMock('../src/db.js', () => ({ getDatabase: jest.fn(async () => ({})) }));
    const MarginMap = require('../src/marginMap');
    return new MarginMap(3);
  }

  test('long perp + long put floors liquidation at put strike', async () => {
    const mm = makeMarginMap();
    mm.margins.set('addr-long', {
      contracts: 1,
      options: {
        '3-1000-P-120': { contracts: 1, avgPrice: 0, margin: 0 }
      }
    });

    const adjusted = await mm.calcLiquidationWithOptions('addr-long', 80, 100, 1000);
    expect(adjusted).toBe(120);
  });

  test('short perp + long call caps liquidation at call strike', async () => {
    const mm = makeMarginMap();
    mm.margins.set('addr-short', {
      contracts: -1,
      options: {
        '3-1000-C-140': { contracts: 1, avgPrice: 0, margin: 0 }
      }
    });

    const adjusted = await mm.calcLiquidationWithOptions('addr-short', 170, 100, 1000);
    expect(adjusted).toBe(140);
  });
});
