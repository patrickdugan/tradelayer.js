const Options = require('../src/options');

describe('Options portfolio maintenance', () => {
  test('naked short call keeps 10 percent maintenance rule', () => {
    const maint = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -2, expiryBlock: 1000 }
    ], 150);
    expect(maint.toNumber()).toBe(30);
  });

  test('covered call spread receives offset vs naked', () => {
    const naked = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 }
    ], 150);

    const spread = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 },
      { type: 'Call', strike: 150, qty: 1, expiryBlock: 1000 }
    ], 150);

    expect(naked.toNumber()).toBe(15);
    expect(spread.lt(naked)).toBe(true);
    expect(spread.toNumber()).toBe(12);
  });

  test('unwinding long wing reverts spread back to naked maintenance', () => {
    const spread = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 },
      { type: 'Call', strike: 150, qty: 1, expiryBlock: 1000 }
    ], 150);
    const afterUnwind = Options.portfolioMaintenance([
      { type: 'Call', strike: 120, qty: -1, expiryBlock: 1000 }
    ], 150);

    expect(spread.toNumber()).toBe(12);
    expect(afterUnwind.toNumber()).toBe(15);
    expect(afterUnwind.gt(spread)).toBe(true);
  });
});
