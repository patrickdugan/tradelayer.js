const crypto = require('crypto');
const secp = require('tiny-secp256k1');
const DlcOracleBridge = require('../src/dlcOracleBridge.js');

describe('DLC relay signature + procedural token validity gates', () => {
  test('dlc relay bundle verifies with valid secp256k1 signature', () => {
    let priv;
    do {
      priv = crypto.randomBytes(32);
    } while (!secp.isPrivate(priv));
    const pubkey = Buffer.from(secp.pointFromScalar(priv, true)).toString('hex');

    const bundle = {
      eventId: 'btc-usd-2026-12-31',
      outcome: '56000',
      outcomeIndex: 0,
      stateHash: 'abc123state',
      timestamp: 1767225600
    };
    const msg = JSON.stringify(bundle);
    const msgHash = crypto.createHash('sha256').update(Buffer.from(msg, 'utf8')).digest();
    const sig = secp.sign(msgHash, priv);

    const out = DlcOracleBridge.validateRelayBundle({
      ...bundle,
      oraclePubkeyHex: pubkey,
      signatureHex: Buffer.from(sig).toString('hex')
    }, 'abc123state');
    expect(out.valid).toBe(true);
  });

  test('node-dlc style relay blob parses into canonical bundle', () => {
    const raw = {
      oracleEventId: 'evt-1',
      outcomes: ['YES'],
      tradeLayerStateHash: 'state-x',
      event_maturity_epoch: 1234,
      oracle_public_key: '02'.padEnd(66, 'a'),
      signatures: ['11'.repeat(64)]
    };
    const parsed = DlcOracleBridge.parseRelayBlob(JSON.stringify(raw));
    expect(parsed.eventId).toBe('evt-1');
    expect(parsed.outcome).toBe('YES');
    expect(parsed.stateHash).toBe('state-x');
  });

  function loadValidity({
    property = { type: 7, issuer: 'tk-admin' },
    issuanceGate = { valid: true },
    redemptionGate = { valid: true }
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
      isManagedAndAdmin: jest.fn(async () => true)
    }));
    jest.doMock('../src/oracle.js', () => ({
      getOracleInfo: jest.fn(async () => ({ adminAddress: 'or-admin', backupAddress: 'or-backup' }))
    }));
    jest.doMock('../src/tally.js', () => ({
      getTally: jest.fn(async () => ({ available: 100 }))
    }));
    jest.doMock('../src/procedural.js', () => ({
      ProceduralRegistry: {
        ensureIssuanceContext: jest.fn(async () => issuanceGate),
        ensureRedemptionContext: jest.fn(async () => redemptionGate)
      }
    }));
    jest.doMock('../src/db', () => ({}));
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
    jest.doMock('../src/clearlist.js', () => ({ getList: jest.fn(async () => ({ adminAddress: 'a' })) }));

    const Validity = require('../src/validity.js');
    jest.spyOn(Validity, 'isActivated').mockResolvedValue(true);
    return Validity;
  }

  test('procedural token grant requires valid DLC issuance context', async () => {
    const Validity = loadValidity({ issuanceGate: { valid: false, reason: 'DLC contract not mintable' } });
    const out = await Validity.validateGrantManagedToken(
      'tk-admin',
      {
        propertyId: 9,
        amountGranted: 1,
        addressToGrantTo: 'tltc1qabc',
        dlcTemplateId: 'tpl-1',
        dlcContractId: 'ct-1',
        settlementState: 'DISPUTED',
        block: 1
      },
      'tx-gm-proc'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/not mintable/i);
  });

  test('procedural token redeem requires redeemable DLC state', async () => {
    const Validity = loadValidity({ redemptionGate: { valid: false, reason: 'DLC contract state OPEN not redeemable' } });
    const out = await Validity.validateRedeemManagedToken(
      'tk-admin',
      {
        propertyId: 9,
        amountDestroyed: 1,
        dlcTemplateId: 'tpl-1',
        dlcContractId: 'ct-1',
        settlementState: 'OPEN',
        block: 1
      },
      'tx-rm-proc'
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/not redeemable/i);
  });
});
