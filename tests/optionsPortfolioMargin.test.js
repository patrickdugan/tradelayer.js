const Options = require('../src/options');

describe('Options portfolio maintenance', () => {
  test('naked short call keeps 10 percent maintenance rule', () => {
    const maint = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -2, expiryBlock: 1000 }
    ], 150);
    expect(maint).toBe(30);
  });

  test('covered call spread receives offset vs naked', () => {
    const naked = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 }
    ], 150);

    const spread = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 },
      { type: 'Call', strike: 150, qty: 1, expiryBlock: 1000 }
    ], 150);

    expect(naked).toBe(15);
    expect(spread).toBeLessThan(naked);
    expect(spread).toBe(12);
  });

  test('unwinding long wing reverts spread back to naked maintenance', () => {
    const spread = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 },
      { type: 'Call', strike: 150, qty: 1, expiryBlock: 1000 }
    ], 150);
    const afterUnwind = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 }
    ], 150);

    expect(spread).toBe(12);
    expect(afterUnwind).toBe(15);
    expect(afterUnwind).toBeGreaterThan(spread);
  });
});
