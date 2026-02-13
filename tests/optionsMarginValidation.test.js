describe('Option margin validation', () => {
  function loadValidityWithMocks({ sellerAvailable, buyerAvailable, sellerOptions = {} }) {
    jest.resetModules();

    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/db', () => ({}));
    jest.doMock('../src/activation.js', () => ({ getInstance: () => ({}) }));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: {},
      SettleType: {},
      SettleStatus: {}
    }));

    jest.doMock('../src/contractRegistry.js', () => ({
      getContractInfo: jest.fn(async () => ({
        collateralPropertyId: 1,
        inverse: false,
        notionalValue: 1
      }))
    }));

    jest.doMock('../src/channels.js', () => ({
      getCommitAddresses: jest.fn(async () => ({
        commitAddressA: 'sellerA',
        commitAddressB: 'buyerB'
      })),
      getChannel: jest.fn(async () => ({
        A: { 1: 0 },
        B: { 1: 0 }
      }))
    }));

    jest.doMock('../src/tally.js', () => ({
      getTally: jest.fn(async (address) => {
        if (address === 'sellerA') return { available: sellerAvailable };
        if (address === 'buyerB') return { available: buyerAvailable };
        return { available: 0 };
      })
    }));

    jest.doMock('../src/marginMap.js', () => ({
      getInstance: jest.fn(async () => ({
        margins: new Map([
          ['sellerA', { options: sellerOptions }],
          ['buyerB', { options: {} }]
        ])
      }))
    }));

    return require('../src/validity.js');
  }

  test('naked write uses strike/10 initial margin and carries net premium', async () => {
    const Validity = loadValidityWithMocks({ sellerAvailable: 150, buyerAvailable: 20 });

    const params = {
      ticker: '3-9000-C-200',
      amount: 5,
      price: 2,
      columnAIsSeller: true,
      block: 100
    };

    const out = await Validity.validateOptionTrade('channel1', params, 'tx1');
    expect(out.valid).toBe(true);
    expect(out.creditMargin).toBe(100);
    expect(out.netPremium).toBe(10);
    expect(out.blockHeight).toBe(100);
  });

  test('fails when buyer cannot fund option premium', async () => {
    const Validity = loadValidityWithMocks({ sellerAvailable: 150, buyerAvailable: 5 });

    const params = {
      ticker: '3-9000-C-200',
      amount: 5,
      price: 2,
      columnAIsSeller: true,
      block: 100
    };

    const out = await Validity.validateOptionTrade('channel1', params, 'tx1');
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/option premium/);
  });

  test('vertical spread margin uses max-loss framing (width less credit)', async () => {
    const Validity = loadValidityWithMocks({ sellerAvailable: 500, buyerAvailable: 500 });

    const params = {
      ticker: '3-9000-C-120',
      comboTicker: '3-9000-C-140',
      amount: 2,
      comboAmount: 2,
      price: 3,
      comboPrice: 1,
      columnAIsSeller: true,
      block: 100
    };

    const out = await Validity.validateOptionTrade('channel1', params, 'tx1');
    expect(out.valid).toBe(true);
    // width(20)*qty(2)=40, net credit=(3-1)*2=4 => IM=36
    expect(out.creditMargin).toBe(36);
    expect(out.netPremium).toBe(4);
  });

  test('unwinding protective long first increases seller margin transition', async () => {
    const sellerOptions = {
      '3-9000-C-120': { contracts: -1, avgPrice: 0, margin: 0 },
      '3-9000-C-130': { contracts: 1, avgPrice: 0, margin: 0 }
    };
    const Validity = loadValidityWithMocks({ sellerAvailable: 50, buyerAvailable: 50, sellerOptions });
    jest.spyOn(Validity, 'hasReferencePrice').mockResolvedValue(108);

    const params = {
      ticker: '3-9000-C-130',
      amount: 1,
      price: 0,
      columnAIsSeller: true,
      block: 100
    };

    const out = await Validity.validateOptionTrade('channel1', params, 'tx2');
    expect(out.valid).toBe(true);
    expect(out.sellerReducing).toBe(true);
    // covered spread -> naked short transition should require additional lock
    expect(out.creditMargin).toBeGreaterThan(0);
  });
});
