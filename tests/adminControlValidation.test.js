describe('Admin control validation (tx8/tx11/tx12)', () => {
  function loadValidity({
    clearlist = { adminAddress: 'wl-admin', backupAddress: 'wl-backup' },
    oracle = { adminAddress: 'or-admin', backupAddress: 'or-backup' },
    token = { issuer: 'tk-admin', backupAddress: 'tk-backup', type: 'Managed' },
    managedAndAdmin = true,
    tallyAvailable = 100
  } = {}) {
    jest.resetModules();

    jest.doMock('../src/txUtils.js', () => ({
      validateAddressWrapper: jest.fn(async () => ({ isvalid: true }))
    }));
    jest.doMock('../src/db', () => ({}));
    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({
        isTxTypeActive: jest.fn(async () => true)
      })
    }));
    jest.doMock('../src/property.js', () => ({
      getPropertyData: jest.fn(async () => token),
      isManagedAndAdmin: jest.fn(async () => managedAndAdmin)
    }));
    jest.doMock('../src/oracle.js', () => ({
      getOracleInfo: jest.fn(async () => oracle)
    }));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: {},
      SettleType: {},
      SettleStatus: {}
    }));
    jest.doMock('../src/clearlist.js', () => ({
      getList: jest.fn(async () => clearlist)
    }));
    jest.doMock('../src/tally.js', () => ({
      getTally: jest.fn(async () => ({ available: tallyAvailable }))
    }));

    const Validity = require('../src/validity.js');
    jest.spyOn(Validity, 'isActivated').mockResolvedValue(true);
    return Validity;
  }

  test('tx8 whitelist admin update allows backup admin', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateUpdateAdmin(
      'wl-backup',
      { whitelist: true, oracle: false, token: false, id: 1, newAddress: 'tltc1qxyz', block: 1 },
      'tx-wl'
    );
    expect(out.valid).toBe(true);
  });

  test('tx8 oracle admin update allows backup admin and rejects multi-target', async () => {
    const Validity = loadValidity();
    const ok = await Validity.validateUpdateAdmin(
      'or-backup',
      { whitelist: false, oracle: true, token: false, id: 2, newAddress: 'tltc1qxyz', block: 1 },
      'tx-or'
    );
    expect(ok.valid).toBe(true);

    const bad = await Validity.validateUpdateAdmin(
      'or-backup',
      { whitelist: true, oracle: true, token: false, id: 2, newAddress: 'tltc1qxyz', block: 1 },
      'tx-or-bad'
    );
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/Exactly one admin target/i);
  });

  test('tx11 grant managed requires managed-admin sender', async () => {
    const Validity = loadValidity({ managedAndAdmin: false });
    const out = await Validity.validateGrantManagedToken(
      'tk-admin',
      { propertyId: 9, amountGranted: 1, addressToGrantTo: 'tltc1qabc', block: 1 },
      'tx-gm'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/managed type or admin/i);
  });

  test('tx11 grant managed falls back to reference address when payload destination is missing', async () => {
    const Validity = loadValidity({ managedAndAdmin: true });
    const out = await Validity.validateGrantManagedToken(
      'tk-admin',
      { propertyId: 9, amountGranted: 1, addressToGrantTo: '', block: 1 },
      'tx-gm-ref',
      { address: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw' }
    );
    expect(out.valid).toBe(true);
    expect(out.addressToGrantTo).toBe('tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw');
  });

  test('tx11 grant managed rejects missing payload and reference destination', async () => {
    const Validity = loadValidity({ managedAndAdmin: true });
    const out = await Validity.validateGrantManagedToken(
      'tk-admin',
      { propertyId: 9, amountGranted: 1, addressToGrantTo: '', block: 1 },
      'tx-gm-no-dst'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/Destination address missing/i);
  });

  test('tx12 redeem managed enforces admin and balance', async () => {
    const Validity = loadValidity({ managedAndAdmin: true, tallyAvailable: 0.5 });
    const out = await Validity.validateRedeemManagedToken(
      'tk-admin',
      { propertyId: 9, amountDestroyed: 1, block: 1 },
      'tx-rm'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/insufficient balance/i);
  });
});
