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

  test('encodeGrantManagedToken prefers redeemAddress over addressToGrantTo', () => {
    const encoded = Encode.encodeGrantManagedToken({
      propertyId: 5,
      amountGranted: 1,
      redeemAddress: 'redeem-destination',
      addressToGrantTo: 'fallback-destination'
    });

    const parts = encoded.slice(3).split(',');
    expect(parts[2]).toBe('redeem-destination');
  });

  test('encodeRedeemManagedToken emits the compact 4-field payload', () => {
    const encoded = Encode.encodeRedeemManagedToken({
      propertyId: 5,
      amountDestroyed: 1.25,
      dlcTemplateId: 'tpl-1',
      dlcContractId: 'ct-1',
      settlementState: 'SETTLED'
    });

    const parts = encoded.slice(3).split(',');
    expect(parts).toHaveLength(4);
    expect(Decode.decodeRedeemManagedToken(encoded.slice(3))).toMatchObject({
      propertyId: 5,
      amountDestroyed: 1.25,
      dlcTemplateId: 'tpl-1',
      dlcContractId: 'ct-1',
      settlementState: ''
    });
  });

  function loadValidity({
    property = { type: 2, issuer: 'admin' },
    isManagedAndAdmin = true,
    listed = true,
    outputs = [{ address: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw', satoshis: 100000000, vout: 0 }]
  } = {}) {
    jest.resetModules();
    jest.doMock('../src/txUtils.js', () => ({
      validateAddressWrapper: jest.fn(async () => ({ isvalid: true })),
      getTransactionOutputs: jest.fn(async () => outputs)
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
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        ensureIssuanceContext: jest.fn(async (templateId, contractId, settlementState, dlcHash) => {
          if (!templateId) {
            return { valid: false, reason: 'Missing dlcTemplateId for procedural token' };
          }
          if (!dlcHash) {
            return { valid: false, reason: 'Missing dlcHash for procedural token issuance' };
          }
          return { valid: true };
        }),
        ensureRedemptionContext: jest.fn(async (templateId, contractId, settlementState) => {
          if (!templateId || !contractId) {
            return { valid: false, reason: 'Missing dlcTemplateId/dlcContractId for procedural redemption' };
          }
          return { valid: true };
        }),
        ensureRedemptionRequestContext: jest.fn(async (templateId, contractId, settlementState) => {
          if (!templateId || !contractId) {
            return { valid: false, reason: 'Missing dlcTemplateId/dlcContractId for procedural redemption' };
          }
          return { valid: true };
        })
      }
    }));

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

  test('procedural tx11 credits the sender while preserving the reference address', async () => {
    const Validity = loadValidity({
      property: { type: 7, issuer: 'admin' },
      outputs: [{ address: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw', satoshis: 100000000, vout: 0 }]
    });

    const out = await Validity.validateGrantManagedToken(
      'admin',
      {
        propertyId: 5,
        amountGranted: 1,
        addressToGrantTo: '',
        dlcTemplateId: 'tpl-1',
        dlcContractId: 'ct-1',
        settlementState: 'FUNDED',
        dlcHash: 'x',
        block: 1
      },
      'tx-11-proc-ok',
      { address: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw' }
    );
    expect(out.valid).toBe(true);
    expect(out.addressToGrantTo).toBe('admin');
    expect(out.referenceAddress).toBe('tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw');
    expect(out.redeemAddress).toBe('tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw');
  });

  test('procedural tx11 allows reference-backed issuance without admin when the receipt metadata is present', async () => {
    const Validity = loadValidity({
      property: { type: 7, issuer: 'admin' },
      isManagedAndAdmin: false,
      outputs: [{ address: 'tltc1qrefholder', satoshis: 440780, vout: 0 }]
    });

    const out = await Validity.validateGrantManagedToken(
      'holder',
      {
        propertyId: 5,
        amountGranted: 0.0044078,
        addressToGrantTo: 'tltc1qrecipient',
        dlcTemplateId: 'tpl-1',
        dlcContractId: 'ct-1',
        settlementState: 'FUNDED',
        dlcHash: 'x',
        block: 1
      },
      'tx-11-proc-backed'
    );
    expect(out.valid).toBe(true);
    expect(out.addressToGrantTo).toBe('holder');
    expect(out.redeemAddress).toBe('tltc1qrecipient');
    expect(out.referenceAddress).toBe('tltc1qrefholder');
    expect(out.referenceSatoshis).toBe(440780);
  });

  test('procedural tx11 still validates when property metadata has not been reconstructed yet', async () => {
    const Validity = loadValidity({
      property: null,
      isManagedAndAdmin: false,
      outputs: [{ address: 'tltc1qrefholder', satoshis: 440780, vout: 0 }]
    });

    const out = await Validity.validateGrantManagedToken(
      'holder',
      {
        propertyId: 380,
        amountGranted: 0.0044078,
        addressToGrantTo: 'tltc1qrecipient',
        dlcTemplateId: '1ghngr1',
        dlcContractId: '',
        settlementState: '',
        dlcHash: '1158pqh',
        block: 4636716
      },
      'c38846b321b656d8c65d1777f93a327c32e73ffe9579b2cf81cd7709deb37742'
    );

    expect(out.valid).toBe(true);
    expect(out.reason).toBe('');
  });

  test('procedural tx11 sums indexed funding route outputs instead of wallet change', async () => {
    const Validity = loadValidity({
      property: { type: 7, issuer: 'admin' },
      isManagedAndAdmin: false,
      outputs: [
        { address: 'tltc1qfunding', satoshis: 90024, vout: 0 },
        { address: 'tltc1qoperator', satoshis: 9976, vout: 1 },
        { address: 'tltc1qchange', satoshis: 2848620, vout: 2 }
      ]
    });

    const out = await Validity.validateGrantManagedToken(
      'holder',
      {
        propertyId: 380,
        amountGranted: 0.001,
        addressToGrantTo: 'tltc1qfunding',
        dlcTemplateId: '1ghngr1',
        dlcContractId: '',
        settlementState: 'FUNDED',
        dlcHash: '1158pqh',
        block: 4636716
      },
      'tx-11-route-backed',
      [
        { address: 'tltc1qfunding', satoshis: 90024, vout: 0 },
        { address: 'tltc1qoperator', satoshis: 9976, vout: 1 }
      ]
    );

    expect(out.valid).toBe(true);
    expect(out.referenceSatoshis).toBe(100000);
    expect(out.referenceOutputs).toHaveLength(2);
  });

  test('procedural tx11 rejects missing DLC metadata', async () => {
    const Validity = loadValidity({ property: { type: 7, issuer: 'admin' } });
    const out = await Validity.validateGrantManagedToken(
      'admin',
      {
        propertyId: 5,
        amountGranted: 1,
        addressToGrantTo: 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw',
        dlcHash: 'x',
        block: 1
      },
      'tx-11-proc-missing-meta'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/Missing dlcTemplateId/i);
  });

  test('procedural tx11 rejects funding output mismatches', async () => {
    const Validity = loadValidity({
      property: { type: 7, issuer: 'admin' },
      isManagedAndAdmin: false,
      outputs: [{ address: 'tltc1qrefholder', satoshis: 440780, vout: 0 }]
    });

    const out = await Validity.validateGrantManagedToken(
      'holder',
      {
        propertyId: 380,
        amountGranted: 0.0044,
        addressToGrantTo: 'tltc1qrecipient',
        dlcTemplateId: '1ghngr1',
        dlcContractId: '',
        settlementState: '',
        dlcHash: '1158pqh',
        block: 4636716
      },
      'c38846b321b656d8c65d1777f93a327c32e73ffe9579b2cf81cd7709deb37742'
    );

    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/exceed procedural issuance cap/i);
  });
});
