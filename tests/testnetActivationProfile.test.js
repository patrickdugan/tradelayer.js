const {
  DEFAULT_BTCTEST_ADMIN_ADDRESS,
  buildActivationManifest,
  registryFromManifest,
  uniqueTxTypes
} = require('../scripts/testnetActivationProfile');
const { dbChainFromNetwork, buildMergedRegistry } = require('../scripts/setupTestnetActivationSet');

describe('testnet activation profile', () => {
  test('covers the tx types needed for LN-BTC TLUSD tx33 demo', () => {
    const txTypes = uniqueTxTypes();
    expect(txTypes).toEqual([...txTypes].sort((a, b) => a - b));
    expect(txTypes).toEqual(expect.arrayContaining([
      0, 1, 2, 4,
      11, 12,
      13, 14, 16, 18, 19,
      20, 21, 22, 23,
      24, 25, 26, 27,
      30, 31, 33, 34
    ]));
  });

  test('builds an activation registry with block and code hash metadata', () => {
    const manifest = buildActivationManifest({
      network: 'BTCTEST',
      activationBlock: 123
    });
    const registry = registryFromManifest(manifest);

    expect(manifest.adminAddress).toBe(DEFAULT_BTCTEST_ADMIN_ADDRESS);
    for (const txType of manifest.txTypes) {
      expect(registry[txType].active).toBe(true);
      expect(registry[txType].activationBlock).toBe(123);
      expect(registry[txType].codeHash).toBe(manifest.codeHash);
      expect(registry[txType].network).toBe('BTCTEST');
    }

    expect(registry[33].name).toBe('Colored Coin');
    expect(manifest.setupPlan.some((step) => step.includes('tx33'))).toBe(true);
  });

  test('defaults to BTCTEST and maps testnet labels to existing DB conventions', () => {
    expect(buildActivationManifest().network).toBe('BTCTEST');
    expect(dbChainFromNetwork('BTCTEST')).toBe('BTC');
    expect(dbChainFromNetwork('LTCTEST')).toBe('LTC');
    expect(dbChainFromNetwork('BTC_TESTNET4')).toBe('BTC');
  });

  test('merges into existing registry without deactivating unrelated types', async () => {
    const manifest = buildActivationManifest({ activationBlock: 55 });
    const activationsDB = {
      findOneAsync: jest.fn(async () => ({
        _id: 'activationsList',
        value: JSON.stringify({
          3: { name: 'Trade Token for UTXO', active: true, activationBlock: 9 },
          33: { name: 'Colored Coin', active: false }
        })
      }))
    };

    const merged = await buildMergedRegistry(activationsDB, manifest);
    expect(merged[3].active).toBe(true);
    expect(merged[3].activationBlock).toBe(9);
    expect(merged[33].active).toBe(true);
    expect(merged[33].activationBlock).toBe(55);
  });
});
