describe('procedural grant bootstrap semantics', () => {
  test('procedural tx11 bootstraps a missing property record before crediting supply', async () => {
    jest.resetModules();

    const addProperty = jest.fn(async () => true);
    const grantTokens = jest.fn(async () => true);

    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({})
    }));
    jest.doMock('../src/property.js', () => ({
      load: jest.fn(async () => true),
      getPropertyData: jest.fn(async () => null),
      isManagedAndAdmin: jest.fn(async () => false),
      getInstance: () => ({
        addProperty,
        grantTokens
      })
    }));
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        ensureIssuanceContext: jest.fn(async () => ({ valid: true }))
      }
    }));
    jest.doMock('../src/tally.js', () => ({}));
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

    await Logic.grantManagedToken(
      380,
      0.0005,
      'tltc1qpvycy24gkt539w8lz4fzvkwff0lld5zdzdf7tn',
      'tltc1qt8runj85htfsz578puvrck23c0razsmk3j0nqa',
      4636716,
      '1158pqh',
      '1ghngr1',
      '',
      ''
    );

    expect(addProperty).toHaveBeenCalledWith(
      380,
      'proc-380',
      0,
      'Procedural',
      null,
      'tltc1qt8runj85htfsz578puvrck23c0razsmk3j0nqa',
      null,
      { proceduralType: 1 }
    );
    expect(grantTokens).toHaveBeenCalledWith(
      380,
      'tltc1qpvycy24gkt539w8lz4fzvkwff0lld5zdzdf7tn',
      0.0005,
      4636716
    );
  });
});
