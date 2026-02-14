const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createOracleSigner } = require('./makeshiftOracle.js');

async function run() {
  // Isolated NeDB root for repeatable local runs.
  process.env.AUTODETECT = '0';
  process.env.CHAIN = 'LTC';
  process.env.RPC_HOST = '127.0.0.1';
  process.env.RPC_PORT = '19332';
  process.env.RPC_USER = 'user';
  process.env.RPC_PASS = 'pass';
  process.env.TL_NEDB_ROOT = 'nedb-data-dlc-scenario';
  process.env.TL_SKIP_RPC_BOOT = '1';
  process.env.TL_FORCE_TEST = '1';

  const dbRoot = path.join(__dirname, '..', process.env.TL_NEDB_ROOT);
  fs.rmSync(dbRoot, { recursive: true, force: true });

  const PropertyManager = require('../src/property.js');
  const TallyMap = require('../src/tally.js');
  const Logic = require('../src/logic.js');
  const OracleList = require('../src/oracle.js');
  const Validity = require('../src/validity.js');
  const Activation = require('../src/activation.js');
  const { ProceduralRegistry } = require('../src/procedural.js');

  const admin = 'admin-protocol';
  const oracleAdmin = 'oracle-admin';
  const oracleBad = 'oracle-bad';
  const challenger = 'oracle-challenger';
  const depA = 'depositor-A';
  const depB = 'depositor-B';
  const depC = 'depositor-C';

  const pm = PropertyManager.getInstance();
  const activation = Activation.getInstance();
  await activation.activate(30, 1, 'dlc-scenario');
  const tLTC = await pm.createToken('tLTC', 0, 'Fixed', 0, admin, '');
  const dlcToken = await pm.createToken('DLC1', 0, 'Procedural', 0, admin, '');

  // Seed balances for collateral and stake.
  await TallyMap.updateBalance(depA, tLTC, 500, 0, 0, 0, 'seed', 1);
  await TallyMap.updateBalance(depB, tLTC, 350, 0, 0, 0, 'seed', 1);
  await TallyMap.updateBalance(depC, tLTC, 200, 0, 0, 0, 'seed', 1);
  await TallyMap.updateBalance(oracleBad, tLTC, 300, 0, 0, 0, 'seed', 1);

  // DLC contract + oracle setup.
  const oracleId = await OracleList.createOracle('DLC_STATE', oracleAdmin);
  await ProceduralRegistry.upsertTemplate('tpl-1', {
    oracleId,
    collateralPropertyId: tLTC,
    receiptPropertyId: dlcToken
  });
  await ProceduralRegistry.upsertContract('ct-1', 'tpl-1', 'FUNDED', {
    createdBy: admin
  });

  // Bad oracle stakes property 1 (tLTC) so it can be slashed.
  await Logic.processStakeFraudProof(oracleBad, {
    action: 0,
    oracleId,
    stakedPropertyId: tLTC,
    amount: 100
  }, 2);

  // Multiple depositors move tLTC into DLC vault and receive procedural receipt token.
  async function depositAndMint(address, amount, block) {
    await TallyMap.updateBalance(address, tLTC, -amount, 0, 0, 0, 'dlcDeposit', block);
    await TallyMap.updateBalance('DLC::ct-1', tLTC, amount, 0, 0, 0, 'dlcVaultIn', block);
    await Logic.grantManagedToken(dlcToken, amount, address, admin, block, 'tpl-1', 'ct-1', 'FUNDED');
  }

  await depositAndMint(depA, 120, 3);
  await depositAndMint(depB, 80, 3);
  await depositAndMint(depC, 40, 3);

  // Simple token trade (OTC transfer simulation between depositors).
  await TallyMap.updateBalance(depA, dlcToken, -30, 0, 0, 0, 'dlcOtcTrade', 4);
  await TallyMap.updateBalance(depB, dlcToken, 30, 0, 0, 0, 'dlcOtcTrade', 4);

  // Makeshift oracle signing.
  const signer = createOracleSigner();
  const goodBundle = signer.signBundle({
    eventId: 'ct-1-expiry',
    outcome: 'UP',
    outcomeIndex: 0,
    stateHash: 'state-ct1-settled',
    timestamp: 1767225600
  });

  // Good relay should validate.
  const goodParams = {
    action: 2,
    oracleId,
    relayType: 1,
    stateHash: 'state-ct1-settled',
    dlcRef: 'ct-1',
    settlementState: 'SETTLED',
    autoRoll: true,
    nextDlcRef: 'ct-2',
    relayBlob: JSON.stringify(goodBundle),
    block: 5
  };
  const goodValidity = await Validity.validateStakeFraudProof(oracleAdmin, goodParams, 'tx-good-relay');
  assert.strictEqual(goodValidity.valid, true, goodValidity.reason);
  await Logic.processStakeFraudProof(oracleAdmin, goodParams, 5);

  // Bad relay signature from same sender should fail validity.
  const badParams = {
    action: 2,
    oracleId,
    relayType: 1,
    stateHash: 'state-ct1-settled',
    dlcRef: 'ct-1',
    settlementState: 'SETTLED',
    relayBlob: JSON.stringify({ ...goodBundle, signatureHex: '00'.repeat(64) }),
    block: 6
  };
  const badValidity = await Validity.validateStakeFraudProof(oracleAdmin, badParams, 'tx-bad-relay');
  assert.strictEqual(badValidity.valid, false);

  // Fraud proof slashes staked property 1 from bad oracle.
  await Logic.processStakeFraudProof(challenger, {
    action: 1,
    oracleId,
    accusedAddress: oracleBad,
    amount: 35,
    evidenceHash: 'bad-relay-proof',
    stakedPropertyId: tLTC
  }, 7);

  const challengerTally = await TallyMap.getTally(challenger, tLTC);
  assert.strictEqual(challengerTally.available, 35);

  // Profit sweep trust path: sweep 20 tLTC from settled vault to depA.
  await TallyMap.updateBalance('DLC::ct-1', tLTC, -20, 0, 0, 0, 'profitSweepOut', 8);
  await TallyMap.updateBalance(depA, tLTC, 20, 0, 0, 0, 'profitSweepIn', 8);

  // User-declared redemption path (holder burns procedural token after oracle-marked closure).
  await ProceduralRegistry.transitionContract('ct-1', 'CLOSED', { closedAt: 9 });
  await Logic.redeemManagedToken(dlcToken, 25, depB, 9, 'tpl-1', 'ct-1', 'CLOSED');
  await TallyMap.updateBalance('DLC::ct-1', tLTC, -25, 0, 0, 0, 'userRedeemOut', 9);
  await TallyMap.updateBalance(depB, tLTC, 25, 0, 0, 0, 'userRedeemIn', 9);

  // Check rollover target seeded by relay auto-roll.
  const rolled = await ProceduralRegistry.getContract('ct-2');
  assert.strictEqual(String(rolled?.state || '').toUpperCase(), 'FUNDED');

  const depBTokens = await TallyMap.getTally(depB, dlcToken);
  const vault = await TallyMap.getTally('DLC::ct-1', tLTC);

  console.log('DLC scenario complete');
  console.log(JSON.stringify({
    oracleId,
    tokenIds: { tLTC, dlcToken },
    depBReceiptTokenAfterRedemption: depBTokens.available,
    dlcVaultRemaining_tLTC: vault.available,
    rolloverTargetState: rolled.state
  }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
