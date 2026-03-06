describe('Options ADL edge path', () => {
  test('empty-book liquidation routes to ADL and zeroes liquidated perp position', async () => {
    jest.resetModules();

    const simpleDeleverage = jest.fn(async () => ({
      counterparties: [
        {
          address: 'cp1',
          updatedPosition: {
            address: 'cp1',
            contracts: 0,
            margin: 20
          }
        }
      ],
      poolAssignments: [
        { address: 'cp1', poolShare: 5 }
      ]
    }));

    jest.doMock('../src/marginMap.js', () => ({
      getInstance: jest.fn(async () => ({
        computeMaintenanceMarginRequirement: jest.fn(async () => 0),
        generateLiquidationOrder: jest.fn(async () => ({
          amount: 1,
          bankruptcyPrice: 90
        })),
        simpleDeleverage
      }))
    }));

    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/options.js', () => ({
      parseTicker: jest.fn(() => null),
      priceEUApprox: jest.fn(() => 0),
      intrinsic: jest.fn(() => 0),
      portfolioMaintenance: jest.fn(() => 0)
    }));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/insurance.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/iou.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));

    const Clearing = require('../src/clearing.js');

    const ctxKey = Clearing.initPositionCache(3, 700000, [
      { address: 'liqAddr', contracts: 1, margin: 10, unrealizedPNL: -5 },
      { address: 'cp1', contracts: -1, margin: 20, unrealizedPNL: 5 }
    ]);

    const fakeOrderbook = {
      estimateLiquidation: jest.fn(async () => ({ goodFilledSize: 0 })),
      insertOrder: jest.fn(),
      matchContractOrders: jest.fn(),
      processContractMatches: jest.fn(),
      saveOrderBook: jest.fn()
    };

    const fakeTally = {
      getTally: jest.fn(async () => ({ available: 0, margin: 10 })),
      updateBalance: jest.fn(async () => undefined)
    };

    const result = await Clearing.handleLiquidation(
      ctxKey,
      fakeOrderbook,
      fakeTally,
      { address: 'liqAddr', contracts: 1, margin: 10, unrealizedPNL: -5 },
      3,
      700000,
      false,
      5,
      'total',
      5,
      1,
      100,
      true,
      5,
      { available: 0, margin: 10 },
      { lastPrice: 100, thisPrice: 130 }
    );

    expect(result).toBeTruthy();
    expect(result.totalDeleveraged).toBe(1);

    expect(simpleDeleverage).toHaveBeenCalledTimes(1);
    expect(simpleDeleverage.mock.calls[0][2]).toBe(1);
    expect(simpleDeleverage.mock.calls[0][3]).toBe(true);

    const liqPos = Clearing.getPositionsFromCache(ctxKey).find((p) => p.address === 'liqAddr');
    expect(liqPos.contracts).toBe(0);

    const debitCalls = fakeTally.updateBalance.mock.calls.filter((c) => c[6] === 'liquidationPoolDebit');
    const creditCalls = fakeTally.updateBalance.mock.calls.filter((c) => c[6] === 'deleveragePoolCredit');
    expect(debitCalls.length).toBeGreaterThan(0);
    expect(creditCalls.length).toBeGreaterThan(0);
  });

  test('partial liquidation sizes from numeric maintenance requirement', async () => {
    jest.resetModules();

    const generateLiquidationOrder = jest.fn(async (_position, _contractId, amount) => ({
      amount,
      bankruptcyPrice: 95
    }));
    const simpleDeleverage = jest.fn(async () => ({
      counterparties: [],
      poolAssignments: []
    }));

    jest.doMock('../src/marginMap.js', () => ({
      getInstance: jest.fn(async () => ({
        computeMaintenanceMarginRequirement: jest.fn(async () => 8),
        generateLiquidationOrder,
        simpleDeleverage
      }))
    }));

    jest.doMock('../src/contractRegistry.js', () => ({
      getInitialMargin: jest.fn(async () => 2)
    }));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/options.js', () => ({
      parseTicker: jest.fn(() => null),
      priceEUApprox: jest.fn(() => 0),
      intrinsic: jest.fn(() => 0),
      portfolioMaintenance: jest.fn(() => 0)
    }));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/insurance.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/iou.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));

    const Clearing = require('../src/clearing.js');

    const ctxKey = Clearing.initPositionCache(3, 700001, [
      { address: 'liqAddr', contracts: 10, margin: 5, unrealizedPNL: -3 }
    ]);

    const fakeOrderbook = {
      estimateLiquidation: jest.fn(async () => ({ goodFilledSize: 0 })),
      insertOrder: jest.fn(),
      matchContractOrders: jest.fn(),
      processContractMatches: jest.fn(),
      saveOrderBook: jest.fn()
    };

    const fakeTally = {
      getTally: jest.fn(async () => ({ available: 0, margin: 5 })),
      updateBalance: jest.fn(async () => undefined)
    };

    const result = await Clearing.handleLiquidation(
      ctxKey,
      fakeOrderbook,
      fakeTally,
      { address: 'liqAddr', contracts: 10, margin: 5, unrealizedPNL: -3 },
      3,
      700001,
      false,
      5,
      'partial',
      3,
      1,
      100,
      true,
      3,
      { available: 0, margin: 5 },
      { lastPrice: 100, thisPrice: 103 }
    );

    expect(generateLiquidationOrder).toHaveBeenCalledTimes(1);
    expect(generateLiquidationOrder.mock.calls[0][2]).toBe(1.5);
    expect(simpleDeleverage).toHaveBeenCalledTimes(1);
    expect(simpleDeleverage.mock.calls[0][2]).toBe(1.5);
    expect(result.totalDeleveraged).toBe(1.5);
  });
});
