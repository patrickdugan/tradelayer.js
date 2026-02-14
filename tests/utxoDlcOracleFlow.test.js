const Encode = require('../src/txEncoder.js');
const Decode = require('../src/txDecoder.js');

describe('UTXO DLC oracle integration plumbing', () => {
  function loadValidity({
    oracle = { adminAddress: 'or-admin', backupAddress: 'or-backup' },
    stakeProperty = { type: 7, ticker: 'dlcBTC' },
    tallyAvailable = 100
  } = {}) {
    jest.resetModules();

    jest.doMock('../src/txUtils.js', () => ({
      validateAddressWrapper: jest.fn(async () => ({ isvalid: true }))
    }));
    jest.doMock('../src/activation.js', () => ({
      getInstance: () => ({
        isTxTypeActive: jest.fn(async () => true),
        getAdmin: jest.fn(() => 'genesis-admin')
      })
    }));
    jest.doMock('../src/property.js', () => ({
      getPropertyData: jest.fn(async () => stakeProperty)
    }));
    jest.doMock('../src/oracle.js', () => ({
      getOracleInfo: jest.fn(async () => oracle)
    }));
    jest.doMock('../src/tally.js', () => ({
      getTally: jest.fn(async () => ({ available: tallyAvailable }))
    }));
    jest.doMock('../src/db', () => ({}));
    jest.doMock('../src/contractRegistry.js', () => ({}));
    jest.doMock('../src/orderbook.js', () => ({}));
    jest.doMock('../src/channels.js', () => ({}));
    jest.doMock('../src/marginMap.js', () => ({}));
    jest.doMock('../src/clearlist.js', () => ({}));
    jest.doMock('../src/volumeIndex.js', () => ({}));
    jest.doMock('../src/vaults.js', () => ({}));
    jest.doMock('../src/vesting.js', () => ({}));
    jest.doMock('../src/options.js', () => ({}));
    jest.doMock('../src/scaling.js', () => ({
      ScalingL2: {},
      SettleType: {},
      SettleStatus: {}
    }));

    const Validity = require('../src/validity.js');
    jest.spyOn(Validity, 'isActivated').mockResolvedValue(true);
    return Validity;
  }

  test('tx1 decode supports procedural token enum field', () => {
    const decoded = Decode.decodeTokenIssue('a,DLCP,1;2,1,bkp,0,0,2');
    expect(decoded.managed).toBe(true);
    expect(decoded.proceduralType).toBe(2);
  });

  test('tx30 encode/decode stake payload is consistent', () => {
    const encoded = Encode.encodeStakeFraudProof({
      action: 0,
      oracleId: 9,
      stakedPropertyId: 77,
      amount: 12.5,
      accusedAddress: '',
      evidenceHash: '',
      relayType: 0,
      stateHash: '',
      dlcRef: 'dlc-abc'
    });
    expect(encoded.startsWith('tlu')).toBe(true);
    const decoded = Decode.decodeStakeFraudProof(encoded.slice(3));
    expect(decoded.action).toBe(0);
    expect(decoded.oracleId).toBe(9);
    expect(decoded.stakedPropertyId).toBe(77);
    expect(decoded.amount).toBe(12.5);
    expect(decoded.dlcRef).toBe('dlc-abc');
  });

  test('tx30 action=stake enforces available balance', async () => {
    const Validity = loadValidity({ tallyAvailable: 0.25 });
    const out = await Validity.validateStakeFraudProof(
      'staker',
      { action: 0, oracleId: 1, stakedPropertyId: 3, amount: 1, block: 1 },
      'tx-stake'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/Insufficient available balance/i);
  });

  test('tx30 action=relay requires oracle admin/backup + state hash', async () => {
    const Validity = loadValidity();
    const bad = await Validity.validateStakeFraudProof(
      'not-admin',
      { action: 2, oracleId: 1, relayType: 1, stateHash: 'abc', block: 1 },
      'tx-relay-1'
    );
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/oracle admin\/backup/i);

    const ok = await Validity.validateStakeFraudProof(
      'or-admin',
      { action: 2, oracleId: 1, relayType: 1, stateHash: 'state-hash', block: 1 },
      'tx-relay-2'
    );
    expect(ok.valid).toBe(true);
  });
});

