const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.RPC_WALLET = process.env.RPC_WALLET || process.env.WALLET_NAME || 'tl-wallet';

const Encode = require('../src/txEncoder.js');
const Types = require('../src/types.js');
const Logic = require('../src/logic.js');
const TxUtils = require('../src/txUtils.js');
const Consensus = require('../src/consensus.js');
const Activation = require('../src/activation.js');
const OracleList = require('../src/oracle.js');
const TallyMap = require('../src/tally.js');
const { ProceduralRegistry } = require('../src/procedural.js');
const { createOracleSigner } = require('../tests/makeshiftOracle.js');

const ARTIFACT_IN = path.join(__dirname, '..', 'artifacts', 'ltc-second-funder-dlc-perp-tlusd-latest.json');
const ARTIFACT_OUT = path.join(__dirname, '..', 'artifacts', 'ltc-pnl-sweep-state-oracle-latest.json');
const BROADCAST = process.env.TL_BROADCAST !== '0';
const APPLY_IMMEDIATE = process.env.TL_APPLY_IMMEDIATE !== '0';

function sha256Hex(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function parseTL(scriptHex) {
  const markerHex = '746c';
  const pos = String(scriptHex || '').indexOf(markerHex);
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString('utf8');
  if (!ascii.startsWith('tl')) return null;
  const type = parseInt(ascii.slice(2, 3), 36);
  if (!Number.isFinite(type)) return null;
  return { marker: 'tl', type, encodedPayload: ascii.slice(3), ascii };
}

async function ensureTxTypeActive(txType, block) {
  const activation = Activation.getInstance();
  await activation.init();
  if (await activation.isTxTypeActive(txType)) return { txType, changed: false };
  const activationBlock = Math.max(1, block - 1);
  const result = await activation.activate(txType, activationBlock, `ltc-pnl-sweep-demo-${txType}`);
  return { txType, changed: true, activationBlock, result };
}

async function largestUtxo(client, address) {
  const utxos = await client.listUnspent(0, 9999999, [address]);
  return (utxos || [])
    .filter((u) => Number(u.amount || 0) > 0 && u.spendable !== false)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
}

async function broadcastOpReturnTx(client, sender, payload) {
  const utxo = await largestUtxo(client, sender);
  if (!utxo) throw new Error(`No spendable UTXO for ${sender}`);

  const fee = Number(process.env.TL_OPRETURN_FEE || 0.00005);
  const change = Number((Number(utxo.amount) - fee).toFixed(8));
  if (change <= 0) throw new Error(`UTXO ${utxo.txid}:${utxo.vout} too small`);

  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: utxo.txid, vout: utxo.vout }],
    [
      { data: Buffer.from(payload, 'utf8').toString('hex') },
      { [sender]: change }
    ]
  ], false);
  const signed = await client.signrawtransactionwithwallet(raw);
  if (!signed.complete) throw new Error(`wallet did not sign OP_RETURN tx for ${sender}`);
  const decoded = await client.decoderawtransaction(signed.hex);
  const accept = await client.rpcCall('testmempoolaccept', [[signed.hex]], false);
  const txid = BROADCAST ? await client.sendrawtransaction(signed.hex) : decoded.txid;
  return { txid, hex: signed.hex, decoded, accept, fundingUtxo: utxo, payload };
}

async function applyPayloadTx(tx, sender, block) {
  const opret = tx.decoded.vout.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTL(opret?.scriptPubKey?.hex || '');
  if (!parsed) throw new Error(`No TradeLayer payload in ${tx.txid}`);

  const decoded = await Types.decodePayload(
    tx.txid,
    parsed.type,
    parsed.marker,
    parsed.encodedPayload,
    sender,
    null,
    0,
    0,
    block
  );
  decoded.block = block;
  if (decoded.valid !== true) throw new Error(`tx ${tx.txid} invalid: ${decoded.reason || 'unknown'}`);
  if (APPLY_IMMEDIATE) {
    await Logic.typeSwitch(parsed.type, decoded);
    await Consensus.markTxAsProcessed(tx.txid, decoded);
  }
  return { parsed, decoded };
}

async function selectPrivilegedStateOracle(adminAddress) {
  const explicit = Number(process.env.TL_STATE_ORACLE_ID || 0);
  const all = await OracleList.getAllOracles();
  if (explicit) {
    const found = all.find((o) => Number(o.id) === explicit);
    if (!found) throw new Error(`State oracle ${explicit} not found`);
    return found;
  }

  const candidates = all
    .filter((o) => String(o.ticker || o.name || '').toUpperCase() === 'BITVMSTATE')
    .filter((o) => String(o.adminAddress || o?.name?.adminAddress || '') === adminAddress)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  if (candidates.length) return candidates[0];

  const createdId = await OracleList.createOracle({
    ticker: 'BITVMSTATE',
    name: 'BITVMSTATE',
    url: '',
    backupAddress: '',
    clearlists: [],
    lag: 1,
    adminAddress
  }, adminAddress);
  return OracleList.getOracleInfo(createdId);
}

async function main() {
  await TxUtils.init();
  const client = TxUtils.client;
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_IN, 'utf8'));
  const block = Number(process.env.TL_HEADLESS_BLOCK || await client.getBlockCount());
  await ensureTxTypeActive(30, block);

  const propertyId = Number(process.env.TL_PNL_PROPERTY_ID || artifact.procedural.propertyId);
  const amount = Number(process.env.TL_PNL_SWEEP_AMOUNT || 0.0001);
  const fromAddress = process.env.TL_PNL_FROM || artifact.firstFunder;
  const toAddress = process.env.TL_PNL_TO || artifact.secondFunder;
  const oracle = await selectPrivilegedStateOracle(artifact.firstFunder);
  const oracleAdmin = oracle.adminAddress || oracle?.name?.adminAddress || artifact.firstFunder;
  const dlcRef = process.env.TL_PNL_DLC_REF || artifact.procedural.contractId;

  await ProceduralRegistry.upsertTemplate(artifact.procedural.templateId, {
    dlcHash: artifact.procedural.dlcHash,
    templateHash: artifact.procedural.dlcHash,
    oracleId: Number(oracle.id),
    oracleAdminAddress: oracleAdmin,
    stateOracle: 'BITVMSTATE'
  });
  await ProceduralRegistry.upsertContract(dlcRef, artifact.procedural.templateId, 'SETTLED', {
    dlcHash: artifact.procedural.dlcHash,
    redeemAddress: artifact.dlc.address,
    witnessScript: artifact.dlc.witnessScript,
    pubkeys: artifact.dlc.pubkeys,
    oracleId: Number(oracle.id),
    oracleAdminAddress: oracleAdmin
  });

  const balancesBefore = {
    from: await TallyMap.getTally(fromAddress, propertyId),
    to: await TallyMap.getTally(toAddress, propertyId)
  };

  const transition = {
    mode: 'pnl_sweep',
    propertyId,
    amount,
    fromAddress,
    toAddress,
    dlcRef,
    contractId: artifact.perp?.contractId,
    markPrice: Number(process.env.TL_PNL_MARK_PRICE || 2010),
    reason: 'oracle-attested derivative net loss sweep'
  };
  const payloadHash = sha256Hex({
    kind: 'tl-pnl-sweep',
    transition,
    previousStateHash: artifact?.oracleRelay?.stateHash || '',
    block
  });
  const stateHash = payloadHash;
  const signer = createOracleSigner();
  const signed = signer.signBundle({
    eventId: `${dlcRef}-pnl-${shortId()}`,
    outcome: 'PNL_SWEEP',
    outcomeIndex: 3,
    stateHash,
    payloadHash,
    timestamp: Math.floor(Date.now() / 1000)
  });
  const relayBlob = {
    ...signed,
    kind: 'pnl_sweep',
    propertyId,
    payloadHash,
    settlement: {
      ...transition,
      stateHash,
      transitionHash: sha256Hex({
        mode: 'pnl_sweep',
        propertyId,
        amount,
        fromAddress,
        toAddress,
        cacheId: '',
        dlcRef,
        stateHash
      })
    }
  };

  const tx = await broadcastOpReturnTx(client, oracleAdmin, Encode.encodeStakeFraudProof({
    action: 2,
    oracleId: Number(oracle.id),
    relayType: 2,
    stateHash,
    dlcRef,
    settlementState: 'SETTLED',
    relayBlob: JSON.stringify(relayBlob),
    autoRoll: false
  }));
  const applied = await applyPayloadTx(tx, oracleAdmin, block);
  const balancesAfter = {
    from: await TallyMap.getTally(fromAddress, propertyId),
    to: await TallyMap.getTally(toAddress, propertyId)
  };
  const contractAfter = await ProceduralRegistry.getContract(dlcRef);

  const summary = {
    run: `${Date.now()}-${shortId()}`,
    broadcast: BROADCAST,
    applyImmediate: APPLY_IMMEDIATE,
    sourceArtifact: ARTIFACT_IN,
    block,
    txid: tx.txid,
    mempoolAccept: tx.accept,
    parsed: applied.parsed,
    params: applied.decoded,
    stateHash,
    payloadHash,
    pnlSweep: transition,
    stateOracle: {
      id: Number(oracle.id),
      ticker: oracle.ticker || oracle.name,
      adminAddress: oracleAdmin
    },
    balancesBefore,
    balancesAfter,
    contractAfter
  };

  fs.mkdirSync(path.dirname(ARTIFACT_OUT), { recursive: true });
  fs.writeFileSync(ARTIFACT_OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ artifactPath: ARTIFACT_OUT, summary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
