describe('tx9 list-0 attestation semantics', () => {
  function loadValidity() {
    jest.resetModules();
    jest.doMock('../src/txUtils.js', () => ({
      validateAddressWrapper: jest.fn(async () => ({ isvalid: true })),
      getTransactionOutputs: jest.fn(async () => [])
    }));
    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({
        isTxTypeActive: jest.fn(async () => true),
        getAdmin: jest.fn(() => 'admin-addr')
      })
    }));
    jest.doMock('../src/clearlist.js', () => ({
      getClearlistById: jest.fn(async () => false),
      isAddressInClearlist: jest.fn(async () => true)
    }));
    jest.doMock('../src/property.js', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/tally.js', () => ({}));
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
    jest.doMock('../src/dlcOracleBridge.js', () => ({}));
    jest.doMock('../src/procedural.js', () => ({ ProceduralRegistry: {} }));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/db', () => ({}));

    const Validity = require('../src/validity.js');
    jest.spyOn(Validity, 'isActivated').mockResolvedValue(true);
    return Validity;
  }

  test('clearlist id 0 self-cert remains valid with 2-letter country code', async () => {
    const Validity = loadValidity();
    const sender = 'tltc1qselfcertaddr';
    const out = await Validity.validateIssueOrRevokeAttestation(sender, {
      revoke: false,
      id: 0,
      targetAddress: sender,
      metaData: 'CA',
      block: 1
    }, 'tx-9-self-cert');
    expect(out.valid).toBe(true);
  });

  test('banlist update requires protocol admin when using target BANLIST', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateIssueOrRevokeAttestation('not-admin', {
      revoke: false,
      id: 0,
      targetAddress: 'BANLIST',
      metaData: 'US,KP',
      block: 1
    }, 'tx-9-banlist-non-admin');
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/Only protocol admin/i);
  });

  test('banlist update accepts admin with 2-letter codes', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateIssueOrRevokeAttestation('admin-addr', {
      revoke: false,
      id: 0,
      targetAddress: 'BANLIST',
      metaData: 'US;KP;IR',
      block: 1
    }, 'tx-9-banlist-admin');
    expect(out.valid).toBe(true);
  });

  test('banlist update rejects invalid country code payload', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateIssueOrRevokeAttestation('admin-addr', {
      revoke: false,
      id: 0,
      targetAddress: 'BANLIST',
      metaData: 'USA',
      block: 1
    }, 'tx-9-banlist-invalid');
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/2-letter country codes/i);
  });
});
