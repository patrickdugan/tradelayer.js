describe('Restricted procedural token transfer/trade guards', () => {
  function loadValidity() {
    jest.resetModules();
    jest.doMock('../src/txUtils.js', () => ({
      validateAddressWrapper: jest.fn(async () => ({ isvalid: true }))
    }));
    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({
        isTxTypeActive: jest.fn(async () => true),
        getAdmin: jest.fn(() => 'genesis-admin'),
        areActivationsAboveThreshold: jest.fn(() => false)
      })
    }));
    jest.doMock('../src/property.js', () => ({
      getPropertyData: jest.fn(async (pid) => {
        if (Number(pid) === 9001) return { type: 7, proceduralType: 1, whitelistId: 0 };
        return { type: 1, whitelistId: 0 };
      }),
      doesTickerExist: jest.fn(async () => false),
      isManagedAndAdmin: jest.fn(async () => true)
    }));
    jest.doMock('../src/tally.js', () => ({
      getTally: jest.fn(async () => ({ available: 100 })),
      hasSufficientBalance: jest.fn(async () => ({ hasSufficient: true })),
      hasSufficientChannel: jest.fn(async () => ({ hasSufficient: true, shortfall: 0 }))
    }));
    jest.doMock('../src/clearlist.js', () => ({
      isAddressInClearlist: jest.fn(async () => true),
      getAttestations: jest.fn(async () => []),
      getBanlist: jest.fn(async () => []),
      getCountryCodeByAddress: jest.fn(async () => ({ countryCode: 'CA' }))
    }));
    jest.doMock('../src/db', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({
      getCommitAddresses: jest.fn(async () => ({ commitAddressA: 'A', commitAddressB: 'B' }))
    }));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({ getInstance: jest.fn(async () => ({ getChain: () => 'LTCTEST', getTest: () => true })) }));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: {},
      SettleType: {},
      SettleStatus: {}
    }));
    jest.doMock('../src/oracle.js', () => ({
      getOraclePrice: jest.fn(async () => 1),
      getOracleInfo: jest.fn(async () => ({ adminAddress: 'or-admin' })),
      isAdmin: jest.fn(async () => true)
    }));
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        ensureIssuanceContext: jest.fn(async () => ({ valid: true })),
        ensureRedemptionContext: jest.fn(async () => ({ valid: true }))
      }
    }));

    const Validity = require('../src/validity.js');
    jest.spyOn(Validity, 'isActivated').mockResolvedValue(true);
    return Validity;
  }

  test('tx2 send rejects restricted procedural receipt token', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateSend(
      'sender',
      { address: 'tltc1qsomething', recipientAddress: 'tltc1qrecipient', propertyIds: 9001, amounts: 1, block: 1 },
      'tx-send'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/non-transferable/i);
  });

  test('tx5 spot trade rejects restricted procedural token', async () => {
    const Validity = loadValidity();
    const out = await Validity.validateOnChainTokenForToken(
      'sender',
      {
        propertyIdOffered: 9001,
        propertyIdDesired: 1,
        amountOffered: 1,
        amountExpected: 1,
        block: 1
      },
      'tx-spot'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/restricted procedural token/i);
  });
});
