describe('Option liquidation coverage integration', () => {
  function loadClearing() {
    jest.resetModules();
    jest.doMock('../src/db.js', () => ({ getDatabase: jest.fn() }));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/insurance.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/iou.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    return require('../src/clearing');
  }

  test('naked maintenance reduces effective coverage', () => {
    const Clearing = loadClearing();
    const out = Clearing.computeLossCoverage(
      100, // available
      40,  // margin
      { premiumMTM: 0, maintNaked: 15 }
    );

    // base = avail + margin/2 = 120, minus naked maint 15 -> 105
    expect(out.coverage.toNumber()).toBe(105);
    expect(out.maintBase.toNumber()).toBe(20);
    expect(out.optionMaint.toNumber()).toBe(15);
  });

  test('option MTM can offset maintenance drag', () => {
    const Clearing = loadClearing();
    const out = Clearing.computeLossCoverage(
      100,
      40,
      { premiumMTM: 8, maintNaked: 15 }
    );

    expect(out.coverage.toNumber()).toBe(113);
  });
});
