describe('Scaling settlement adversarial validation', () => {
  function loadValidity({
    tx23Active = true,
    tx31Active = true,
    channel = { A: { 1: 50 }, B: { 1: 50 } },
    commitAddresses = { commitAddressA: 'A1', commitAddressB: 'B1' },
    isSettlementNeutralized = false,
    tradeStatus = { status: 'live' },
    scalingDoc = null
  } = {}) {
    jest.resetModules();

    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({
      getContractInfo: jest.fn(async () => ({ leverage: 10 }))
    }));

    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({
        isTxTypeActive: jest.fn(async (txType) => {
          if (txType === 23) return tx23Active;
          if (txType === 31) return tx31Active;
          return true;
        })
      })
    }));

    jest.doMock('../src/channels.js', () => ({
      getChannel: jest.fn(async () => channel),
      getCommitAddresses: jest.fn(async () => commitAddresses)
    }));

    jest.doMock('../src/db', () => ({
      getDatabase: jest.fn(async () => ({
        findOneAsync: jest.fn(async () => scalingDoc)
      }))
    }));

    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: {
        isSettlementNeutralized: jest.fn(async () => isSettlementNeutralized),
        getTradeStatus: jest.fn(async () => tradeStatus)
      },
      SettleType: {
        KEEP_ALIVE: 0,
        CLOSE_POSITION: 1,
        NET_SETTLE: 2,
        KING_SETTLE: 3
      },
      SettleStatus: {
        PENDING: 'pending',
        LIVE: 'live',
        NEUTRALIZED: 'neutralized',
        SWEPT: 'swept'
      }
    }));

    return require('../src/validity.js');
  }

  test('rejects settle tx when channel counterparties are incomplete', async () => {
    const Validity = loadValidity({
      commitAddresses: { commitAddressA: 'A1', commitAddressB: null }
    });
    const out = await Validity.validateSettleChannelPNL(
      'channel-1',
      { settleType: 0, txidNeutralized1: 'trade-1', block: 100 },
      'tx-1'
    );

    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/not a channel participant/i);
  });

  test('rejects keep-alive when reference settlement already neutralized', async () => {
    const Validity = loadValidity({ isSettlementNeutralized: true });
    const out = await Validity.validateSettleChannelPNL(
      'channel-1',
      { settleType: 0, txidNeutralized1: 'trade-1', block: 100 },
      'tx-2'
    );

    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/already superseded/i);
  });

  test('rejects keep-alive on expired trade', async () => {
    const Validity = loadValidity({ tradeStatus: { status: 'expired' } });
    const out = await Validity.validateSettleChannelPNL(
      'channel-1',
      { settleType: 0, txidNeutralized1: 'trade-1', block: 100 },
      'tx-3'
    );

    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/expired trade/i);
  });

  test('rejects net settle when payer balance is exceeded', async () => {
    const Validity = loadValidity({ channel: { A: { 1: 5 }, B: { 1: 90 } } });
    const out = await Validity.validateSettleChannelPNL(
      'channel-1',
      {
        settleType: 2,
        txidNeutralized1: 'close-1',
        propertyId: 1,
        netAmount: 10,
        columnAIsSeller: true,
        block: 100
      },
      'tx-4'
    );

    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/exceeds payer balance/i);
  });

  test('rejects tx23 king-settle path when channelRoot is missing', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateSettleChannelPNL(
      'channel-1',
      {
        settleType: 3,
        propertyId: 1,
        netAmount: 4,
        aPaysBDirection: true,
        blockStart: 90,
        blockEnd: 100,
        block: 100
      },
      'tx-5'
    );

    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/missing channelRoot/i);
  });

  test('counts neutralized entries in valid king settle and rejects future ranges', async () => {
    const Validity = loadValidity({
      channel: { A: { 1: 40 }, B: { 1: 20 } },
      scalingDoc: {
        settlements: [
          { block: 90, status: 'live' },
          { block: 91, status: 'neutralized' }
        ],
        trades: [{ block: 92, status: 'pending' }],
        netSettles: [{ block: 93, status: 'swept' }]
      }
    });

    const ok = await Validity.validateKingSettle(
      'channel-1',
      {
        block: 100,
        blockStart: 90,
        blockEnd: 100,
        propertyId: 1,
        netAmount: 10,
        aPaysBDirection: true,
        channelRoot: 'root-utxo'
      },
      'tx-6'
    );
    expect(ok.valid).toBe(true);
    expect(ok.neutralizedCount).toBe(2);

    const bad = await Validity.validateKingSettle(
      'channel-1',
      {
        block: 89,
        blockStart: 90,
        blockEnd: 100,
        propertyId: 1,
        netAmount: 10,
        aPaysBDirection: true,
        channelRoot: 'root-utxo'
      },
      'tx-7'
    );
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/future block range/i);
  });
});
