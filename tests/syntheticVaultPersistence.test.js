describe('synthetic vault persistence', () => {
  test('loads persisted vault rows and treats vault-backed synths as existing', async () => {
    jest.resetModules();

    const rows = {
      vaults: [
        {
          _id: 's-380-12',
          value: JSON.stringify({
            contracts: 1,
            margin: 0.0000005,
            available: 0.0004995,
            outstanding: 1
          })
        }
      ],
      syntheticTokens: []
    };

    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async (name) => ({
        findAsync: jest.fn(async () => rows[name] || []),
        findOneAsync: jest.fn(async (query) => (rows[name] || []).find((row) => row._id === query._id) || null),
        updateAsync: jest.fn(async () => true)
      }))
    }));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));

    const SynthRegistry = require('../src/vaults.js');

    await expect(SynthRegistry.exists('s-380-12')).resolves.toBe(true);
    await expect(SynthRegistry.getVault('s-380-12')).resolves.toMatchObject({
      contracts: 1,
      margin: 0.0000005,
      available: 0.0004995,
      outstanding: 1
    });
  });

  test('redeem accounting decreases vault contracts and outstanding supply', async () => {
    jest.resetModules();

    const saved = {};
    const rows = {
      vaults: [
        {
          _id: 's-380-12',
          value: JSON.stringify({
            contracts: 1,
            margin: 0.0000005,
            available: 0.0004995,
            outstanding: 1
          })
        }
      ],
      syntheticTokens: []
    };

    jest.doMock('../src/db.js', () => ({
      getDatabase: jest.fn(async (name) => ({
        findAsync: jest.fn(async () => rows[name] || []),
        findOneAsync: jest.fn(async (query) => (rows[name] || []).find((row) => row._id === query._id) || null),
        updateAsync: jest.fn(async (query, doc) => {
          saved[query._id] = JSON.parse(doc.value);
          return true;
        })
      }))
    }));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));

    const SynthRegistry = require('../src/vaults.js');
    await SynthRegistry.updateVaultRedeem('s-380-12', {
      contracts: 1,
      margin: 0.0000005,
      available: 0.0004995
    }, -1);

    expect(saved['s-380-12']).toMatchObject({
      contracts: 0,
      margin: 0,
      available: 0,
      outstanding: 0
    });
  });
});
