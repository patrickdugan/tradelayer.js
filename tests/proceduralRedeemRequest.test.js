describe('procedural redeem request semantics', () => {
  function loadLogic({
    property = { type: 7, issuer: 'admin' },
    isManagedAndAdmin = false
  } = {}) {
    jest.resetModules();

    const updateBalance = jest.fn(async () => true);
    const redeemTokens = jest.fn(async () => true);

    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({})
    }));
    jest.doMock('../src/property.js', () => ({
      isManagedAndAdmin: jest.fn(async () => isManagedAndAdmin),
      getPropertyData: jest.fn(async () => property),
      getInstance: () => ({
        redeemTokens
      })
    }));
    jest.doMock('../src/tally.js', () => ({
      updateBalance
    }));
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        ensureIssuanceContext: jest.fn(async () => ({ valid: true })),
        ensureRedemptionRequestContext: jest.fn(async () => ({ valid: true }))
      }
    }));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/txUtils.js', () => ({}));
    jest.doMock('../src/txIndex.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: {},
      SettleType: {},
      SettleStatus: {}
    }));
    jest.doMock('../src/db.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/tradeHistoryManager.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/bitvmCache.js', () => ({
      BitvmCacheRegistry: {}
    }));
    jest.doMock('../src/bitvmBundle.js', () => ({
      verifyBundleHash: jest.fn(async () => true)
    }));
    jest.doMock('../src/bitvmRisk.js', () => ({}));
    jest.doMock('../src/experimental/binohash/binohashAdapter.js', () => ({}));

    const Logic = require('../src/logic.js');
    return { Logic, updateBalance, redeemTokens };
  }

  test('procedural tx12 moves holder balance from available to reserved', async () => {
    const { Logic, updateBalance, redeemTokens } = loadLogic();

    await Logic.redeemManagedToken(380, 0.0044078, 'holder', 100, 'tpl-1', 'ct-1', 'OPEN');

    expect(updateBalance).toHaveBeenCalledWith(
      'holder',
      380,
      -0.0044078,
      0.0044078,
      0,
      0,
      'proceduralRedeemRequest',
      100
    );
    expect(redeemTokens).not.toHaveBeenCalled();
  });

  test('non-procedural tx12 still destroys managed supply immediately', async () => {
    const { Logic, updateBalance, redeemTokens } = loadLogic({
      property: { type: 2, issuer: 'admin' },
      isManagedAndAdmin: true
    });

    await Logic.redeemManagedToken(9, 1, 'admin', 100, '', '', '');

    expect(redeemTokens).toHaveBeenCalledWith(9, 'admin', 1, 100);
    expect(updateBalance).not.toHaveBeenCalled();
  });
});
