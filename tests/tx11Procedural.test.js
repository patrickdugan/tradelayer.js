const Encode = require('../src/txEncoder.js');
const Decode = require('../src/txDecoder.js');

describe('tx11 grant managed token semantics', () => {
  test('encode/decode carries optional commitClearlistId', () => {
    const encoded = Encode.encodeGrantManagedToken({
      propertyId: 5,
      amountGranted: 42.5,
      addressToGrantTo: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw',
      dlcHash: 'dlc-hash-1',
      commitClearlistId: 12
    });
    const decoded = Decode.decodeGrantManagedToken(encoded.slice(3));
    expect(decoded.propertyId).toBe(5);
    expect(decoded.amountGranted).toBeCloseTo(42.5);
    expect(decoded.dlcHash).toBe('dlc-hash-1');
    expect(decoded.commitClearlistId).toBe(12);
  });

  function loadValidity({
    property = { type: 2, issuer: 'admin' },
    isManagedAndAdmin = true,
    listed = true
  } = {}) {
    jest.resetModules();
    jest.doMock('../src/txUtils.js', () => ({
      validateAddressWrapper: jest.fn(async () => ({ isvalid: true }))
    }));
    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({
        isTxTypeActive: jest.fn(async () => true)
      })
    }));
    jest.doMock('../src/property.js', () => ({
      getPropertyData: jest.fn(async () => property),
      isManagedAndAdmin: jest.fn(async () => isManagedAndAdmin)
    }));
    jest.doMock('../src/clearlist.js', () => ({
      isAddressInClearlist: jest.fn(async () => listed),
      getAttestationHistory: jest.fn(async () => [])
    }));
    jest.doMock('../src/db', () => ({}));
    jest.doMock('../src/oracle.js', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/tally.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));

    const Validity = require('../src/validity.js');
    jest.spyOn(Validity, 'isActivated').mockResolvedValue(true);
    return Validity;
  }

  test('non-procedural tx11 defaults destination to sender/admin when missing', async () => {
    const Validity = loadValidity({ property: { type: 2, issuer: 'admin' } });
    const out = await Validity.validateGrantManagedToken(
      'admin',
      { propertyId: 5, amountGranted: 1.25, addressToGrantTo: '', block: 1 },
      'tx-11-nonproc'
    );
    expect(out.valid).toBe(true);
    expect(out.addressToGrantTo).toBe('admin');
  });

  test('procedural tx11 requires/matches reference address', async () => {
    const Validity = loadValidity({ property: { type: 7, issuer: 'admin' } });

    const ok = await Validity.validateGrantManagedToken(
      'admin',
      { propertyId: 5, amountGranted: 1, addressToGrantTo: '', dlcHash: 'x', block: 1 },
      'tx-11-proc-ok',
      { address: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw' }
    );
    expect(ok.valid).toBe(true);
    expect(ok.addressToGrantTo).toBe('tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw');

    const bad = await Validity.validateGrantManagedToken(
      'admin',
      { propertyId: 5, amountGranted: 1, addressToGrantTo: 'tltc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk6w0zv', dlcHash: 'x', block: 1 },
      'tx-11-proc-bad',
      { address: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw' }
    );
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/must match reference/i);
  });

  test('commitClearlistId enforces recipient attestation', async () => {
    const Validity = loadValidity({ property: { type: 2, issuer: 'admin' }, listed: false });
    const out = await Validity.validateGrantManagedToken(
      'admin',
      {
        propertyId: 5,
        amountGranted: 1,
        addressToGrantTo: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw',
        commitClearlistId: 4,
        block: 1
      },
      'tx-11-clearlist'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/Recipient not in clearlist 4/i);
  });
});
