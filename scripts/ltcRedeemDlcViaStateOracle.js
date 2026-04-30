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
const Validity = require('../src/validity.js');
const TallyMap = require('../src/tally.js');
const { ProceduralRegistry } = require('../src/procedural.js');
const { buildAddressDailyPayload, encodeBalancePayload, payloadHashFromB64 } = require('../src/stateOracle.js');
const { createOracleSigner } = require('../tests/makeshiftOracle.js');

const COIN = 100000000;
const ARTIFACT_IN = path.join(__dirname, '..', 'artifacts', 'ltc-second-funder-dlc-perp-tlusd-latest.json');
const ARTIFACT_OUT = path.join(__dirname, '..', 'artifacts', 'ltc-dlc-redeem-state-oracle-latest.json');
const PNL_ARTIFACT_DEFAULT = path.join(__dirname, '..', 'artifacts', 'ltc-pnl-sweep-state-oracle-latest.json');
const BROADCAST = process.env.TL_BROADCAST !== '0';
const APPLY_IMMEDIATE = process.env.TL_APPLY_IMMEDIATE !== '0';

function sats(coin) {
  return Math.round(Number(coin) * COIN);
}

function ltc(satoshis) {
  return Number((Number(satoshis) / COIN).toFixed(8));
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

function parseRelayBlobRaw(relayBlob) {
  if (!relayBlob) return null;
  try {
    const raw = typeof relayBlob === 'string' && relayBlob.startsWith('b64:')
      ? Buffer.from(relayBlob.slice(4), 'base64').toString('utf8')
      : relayBlob;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadPnlSettlementArtifact() {
  const requested = process.env.TL_DLC_PAYOUT_ARTIFACT || PNL_ARTIFACT_DEFAULT;
  if (!requested || !fs.existsSync(requested)) return null;
  const doc = JSON.parse(fs.readFileSync(requested, 'utf8'));
  const relay = parseRelayBlobRaw(doc?.params?.relayBlob);
  const settlement = relay?.settlement || doc?.pnlSweep || null;
  return settlement ? { path: requested, doc, relay, settlement } : null;
}

function normalizePayoutPlan(rawPayouts, outputSats) {
  const dustSats = Number(process.env.TL_DLC_DUST_SATS || 546);
  const payouts = (rawPayouts || [])
    .map((entry) => ({
      address: entry.address || entry.toAddress || entry.recipientAddress,
      sats: Number(entry.sats ?? entry.amountSats ?? entry.valueSats ?? 0),
      weight: Number(entry.weight ?? entry.tokenAmount ?? entry.amount ?? 0)
    }))
    .filter((entry) => entry.address);
  if (!payouts.length) return [];

  const explicitSats = payouts.reduce((sum, entry) => sum + (Number.isFinite(entry.sats) ? entry.sats : 0), 0);
  if (explicitSats > 0) {
    if (explicitSats !== outputSats) {
      throw new Error(`PNL payout satoshis ${explicitSats} do not match DLC output ${outputSats}`);
    }
    return payouts.map((entry) => {
      if (entry.sats < dustSats) throw new Error(`PNL payout for ${entry.address} is below dust`);
      return { address: entry.address, sats: entry.sats };
    });
  }

  const totalWeight = payouts.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error('PNL payout vector must include positive weights or sats');
  }

  let allocated = 0;
  return payouts.map((entry, index) => {
    const satsOut = index === payouts.length - 1
      ? outputSats - allocated
      : Math.floor((outputSats * entry.weight) / totalWeight);
    allocated += satsOut;
    if (satsOut < dustSats) throw new Error(`PNL payout for ${entry.address} is below dust`);
    return { address: entry.address, sats: satsOut };
  });
}

function deriveDlcPayoutOutputs(artifact, outputSats) {
  const pnl = loadPnlSettlementArtifact();
  if (!pnl) {
    const destination = process.env.TL_DLC_RELEASE_ADDRESS || artifact.secondFunder;
    return {
      source: 'manual-or-default',
      settlement: null,
      outputs: [{ address: destination, sats: outputSats }]
    };
  }

  const settlement = pnl.settlement;
  const rawPayouts = Array.isArray(settlement.utxoPayouts) && settlement.utxoPayouts.length > 0
    ? settlement.utxoPayouts
    : [{
      address: settlement.utxoRecipient || settlement.toAddress || settlement.recipientAddress,
      weight: settlement.amount || 1
    }];
  const outputs = normalizePayoutPlan(rawPayouts, outputSats);
  if (!outputs.length) throw new Error('PNL settlement did not provide a DLC payout recipient');
  return {
    source: pnl.path,
    settlement: {
      mode: settlement.mode,
      dlcRef: settlement.dlcRef,
      propertyId: settlement.propertyId,
      stateHash: settlement.stateHash,
      transitionHash: settlement.transitionHash
    },
    outputs
  };
}

async function ensureTxTypeActive(txType, block) {
  const activation = Activation.getInstance();
  await activation.init();
  const isActive = await activation.isTxTypeActive(txType);
  if (isActive) return { txType, changed: false };
  const activationBlock = Math.max(1, block - 1);
  const result = await activation.activate(txType, activationBlock, `ltc-dlc-redeem-demo-${txType}`);
  return { txType, changed: true, activationBlock, result };
}

async function largestUtxo(client, address, excludes = new Set()) {
  const utxos = await client.listUnspent(0, 9999999, [address]);
  return (utxos || [])
    .filter((u) => Number(u.amount || 0) > 0 && u.spendable !== false)
    .filter((u) => !excludes.has(`${u.txid}:${u.vout}`))
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
}

async function broadcastOpReturnTx(client, sender, payload, excludes = new Set()) {
  const utxo = await largestUtxo(client, sender, excludes);
  if (!utxo) throw new Error(`No spendable UTXO for ${sender}`);
  excludes.add(`${utxo.txid}:${utxo.vout}`);

  const fee = Number(process.env.TL_OPRETURN_FEE || 0.00005);
  const inputAmount = Number(utxo.amount);
  const change = Number((inputAmount - fee).toFixed(8));
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

async function loadExistingTx(client, txid) {
  const decoded = await client.getRawTransaction(txid);
  return {
    txid,
    hex: null,
    decoded,
    accept: null,
    fundingUtxo: null,
    payload: null,
    reused: true
  };
}

async function applyPayloadTx(tx, sender, block, extra = {}) {
  const opret = tx.decoded.vout.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTL(opret?.scriptPubKey?.hex || '');
  if (!parsed) throw new Error(`No TradeLayer payload in ${tx.txid}`);
  const decoded = await Types.decodePayload(
    tx.txid,
    parsed.type,
    parsed.marker,
    parsed.encodedPayload,
    sender,
    extra.referenceOutputs || null,
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
  if (!candidates.length) {
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
  return candidates[0];
}

function encodeSyntheticRedeem(propertyId, contractId, amount) {
  const type = Number(25).toString(36);
  const body = [
    Number(propertyId).toString(36),
    Number(contractId).toString(36),
    Math.round(Number(amount) * COIN).toString(36)
  ].join(',');
  return `tl${type}${body}`;
}

async function redeemSynthetic(client, artifact, excludes, block) {
  const amount = Number(process.env.TL_SYNTH_REDEEM_AMOUNT || 1);
  await ensureTxTypeActive(25, block);
  const payload = encodeSyntheticRedeem(artifact.procedural.propertyId, artifact.perp.contractId, amount);
  const tx = process.env.TL_SYNTH_REDEEM_TXID
    ? await loadExistingTx(client, process.env.TL_SYNTH_REDEEM_TXID)
    : await broadcastOpReturnTx(client, artifact.secondFunder, payload, excludes);
  const applied = await applyPayloadTx(tx, artifact.secondFunder, block);
  return { amount, tx, applied };
}

async function relayStateOracle(client, artifact, oracle, excludes, block) {
  const propertyId = Number(artifact.procedural.propertyId);
  const addresses = [artifact.secondFunder, artifact.firstFunder];
  const payload = await buildAddressDailyPayload({
    propertyId,
    addresses,
    fromBlock: Math.max(0, block - 20),
    toBlock: block,
    bucketSize: 0.0001,
    includeZero: true,
    omitNoOpAddresses: false,
    includeOps: ['issue', 'redeem', 'rpnl']
  });
  const balancePayloadB64 = encodeBalancePayload(payload);
  const payloadHash = payloadHashFromB64(balancePayloadB64);
  const stateHash = payloadHash;
  const signer = createOracleSigner();
  const signed = signer.signBundle({
    eventId: `${artifact.procedural.contractId}-release-${shortId()}`,
    outcome: 'SETTLED',
    outcomeIndex: 1,
    stateHash,
    payloadHash,
    timestamp: Math.floor(Date.now() / 1000)
  });
  const relayBlob = {
    ...signed,
    kind: 'release',
    propertyId,
    balancePayloadB64,
    payloadHash,
    settlement: {
      mode: 'oracle_release',
      propertyId,
      amount: Number(process.env.TL_DLC_REDEEM_AMOUNT || 0.0005),
      fromAddress: artifact.secondFunder,
      dlcRef: artifact.procedural.contractId,
      stateHash,
      reason: 'synthetic redeemed; DLC receipt may be released'
    }
  };

  await ProceduralRegistry.upsertTemplate(artifact.procedural.templateId, {
    dlcHash: artifact.procedural.dlcHash,
    templateHash: artifact.procedural.dlcHash,
    oracleId: Number(oracle.id),
    oracleAdminAddress: oracle.adminAddress || oracle?.name?.adminAddress || artifact.firstFunder,
    stateOracle: 'BITVMSTATE'
  });
  await ProceduralRegistry.upsertContract(artifact.procedural.contractId, artifact.procedural.templateId, 'FUNDED', {
    dlcHash: artifact.procedural.dlcHash,
    redeemAddress: artifact.dlc.address,
    witnessScript: artifact.dlc.witnessScript,
    pubkeys: artifact.dlc.pubkeys,
    oracleId: Number(oracle.id),
    oracleAdminAddress: oracle.adminAddress || oracle?.name?.adminAddress || artifact.firstFunder
  });

  const contractBefore = await ProceduralRegistry.getContract(artifact.procedural.contractId);
  if (Number(contractBefore.oracleId) !== Number(oracle.id)) {
    throw new Error(`DLC contract is not privileged to oracle ${oracle.id}`);
  }

  const tx = await broadcastOpReturnTx(client, oracle.adminAddress || oracle?.name?.adminAddress || artifact.firstFunder, Encode.encodeStakeFraudProof({
    action: 2,
    oracleId: Number(oracle.id),
    relayType: 2,
    stateHash,
    dlcRef: artifact.procedural.contractId,
    settlementState: 'SETTLED',
    relayBlob: JSON.stringify(relayBlob),
    autoRoll: false
  }), excludes);
  const applied = await applyPayloadTx(tx, oracle.adminAddress || oracle?.name?.adminAddress || artifact.firstFunder, block);
  const contractAfter = await ProceduralRegistry.getContract(artifact.procedural.contractId);
  return { oracle, payload, payloadHash, stateHash, relayBlob, tx, applied, contractBefore, contractAfter };
}

async function redeemManagedReceipt(client, artifact, excludes, block) {
  const amount = Number(process.env.TL_DLC_REDEEM_AMOUNT || 0.0005);
  const payload = Encode.encodeRedeemManagedToken({
    propertyId: artifact.procedural.propertyId,
    amountDestroyed: amount,
    dlcTemplateId: artifact.procedural.templateId,
    dlcContractId: artifact.procedural.contractId,
    settlementState: 'SETTLED'
  });
  const tx = await broadcastOpReturnTx(client, artifact.secondFunder, payload, excludes);
  const applied = await applyPayloadTx(tx, artifact.secondFunder, block);
  return { amount, tx, applied };
}

async function spendDlcUtxo(client, artifact) {
  const grantTx = await client.getRawTransaction(artifact.grant.txid);
  const voutIndex = Number(artifact.grant.referenceOutputs[0].vout);
  const vout = grantTx.vout.find((o) => Number(o.n) === voutIndex);
  if (!vout) throw new Error(`Grant output ${voutIndex} not found`);

  const inputSats = sats(vout.value);
  const feeSats = Number(process.env.TL_DLC_SPEND_FEE_SATS || 2000);
  const outputSats = inputSats - feeSats;
  if (outputSats <= 0) throw new Error('DLC output too small to spend');

  const payoutPlan = deriveDlcPayoutOutputs(artifact, outputSats);
  const outputs = payoutPlan.outputs.map((entry) => ({ [entry.address]: ltc(entry.sats) }));
  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: artifact.grant.txid, vout: voutIndex }],
    outputs
  ], false);

  const prevtxs = [{
    txid: artifact.grant.txid,
    vout: voutIndex,
    scriptPubKey: vout.scriptPubKey.hex,
    witnessScript: artifact.dlc.witnessScript,
    amount: Number(vout.value)
  }];
  let signed = await client.rpcCall('signrawtransactionwithwallet', [raw, prevtxs], true);
  if (!signed.complete) {
    const keys = [
      await client.rpcCall('dumpprivkey', [artifact.dlc.partyA], true),
      await client.rpcCall('dumpprivkey', [artifact.dlc.partyB], true)
    ];
    signed = await client.rpcCall('signrawtransactionwithkey', [raw, keys, prevtxs], true);
  }
  const decoded = await client.decoderawtransaction(signed.hex);
  let accept = null;
  let txid = decoded.txid;
  if (signed.complete) {
    accept = await client.rpcCall('testmempoolaccept', [[signed.hex]], false);
    if (BROADCAST) {
      txid = await client.sendrawtransaction(signed.hex);
    }
  }
  return {
    destination: payoutPlan.outputs.length === 1 ? payoutPlan.outputs[0].address : 'pnl-payout-vector',
    payoutPlan,
    input: { txid: artifact.grant.txid, vout: voutIndex, amount: Number(vout.value), address: artifact.dlc.address },
    output: {
      amount: ltc(outputSats),
      feeSats,
      recipients: payoutPlan.outputs.map((entry) => ({ address: entry.address, sats: entry.sats, amount: ltc(entry.sats) }))
    },
    signed,
    decoded,
    accept,
    txid,
    broadcast: BROADCAST && signed.complete
  };
}

async function main() {
  await TxUtils.init();
  const client = TxUtils.client;
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_IN, 'utf8'));
  const block = Number(process.env.TL_HEADLESS_BLOCK || await client.getBlockCount());
  const excludes = new Set();

  if (process.env.TL_ONLY_DLC_SPEND === '1') {
    const previous = fs.existsSync(ARTIFACT_OUT)
      ? JSON.parse(fs.readFileSync(ARTIFACT_OUT, 'utf8'))
      : {};
    const dlcSpend = await spendDlcUtxo(client, artifact);
    const summary = { ...previous, dlcSpend };
    fs.writeFileSync(ARTIFACT_OUT, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ artifactPath: ARTIFACT_OUT, summary }, null, 2));
    return;
  }

  await ensureTxTypeActive(30, block);
  await ensureTxTypeActive(12, block);
  const oracle = await selectPrivilegedStateOracle(artifact.firstFunder);

  const balancesBefore = {
    secondReceipt: await TallyMap.getTally(artifact.secondFunder, artifact.procedural.propertyId),
    secondSynth: await TallyMap.getTally(artifact.secondFunder, artifact.tlusd.syntheticId)
  };
  const syntheticRedeem = process.env.TL_SKIP_SYNTH_REDEEM === '1'
    ? {
      amount: Number(process.env.TL_SYNTH_REDEEM_AMOUNT || 1),
      tx: {
        txid: process.env.TL_SYNTH_REDEEM_TXID || artifact?.syntheticRedeem?.txid || '',
        accept: null,
        reused: true
      },
      applied: {
        decoded: await Consensus.getTxParams(process.env.TL_SYNTH_REDEEM_TXID || '')
      }
    }
    : await redeemSynthetic(client, artifact, excludes, block);
  const oracleRelay = await relayStateOracle(client, artifact, oracle, excludes, block);
  const managedRedeem = await redeemManagedReceipt(client, artifact, excludes, block);
  const dlcSpend = await spendDlcUtxo(client, artifact);
  const balancesAfter = {
    secondReceipt: await TallyMap.getTally(artifact.secondFunder, artifact.procedural.propertyId),
    secondSynth: await TallyMap.getTally(artifact.secondFunder, artifact.tlusd.syntheticId)
  };

  const summary = {
    run: `${Date.now()}-${shortId()}`,
    broadcast: BROADCAST,
    applyImmediate: APPLY_IMMEDIATE,
    sourceArtifact: ARTIFACT_IN,
    dlcContractId: artifact.procedural.contractId,
    dlcAddress: artifact.dlc.address,
    secondFunder: artifact.secondFunder,
    stateOracle: {
      id: Number(oracle.id),
      ticker: oracle.ticker || oracle.name,
      adminAddress: oracle.adminAddress || oracle?.name?.adminAddress || artifact.firstFunder
    },
    balancesBefore,
    syntheticRedeem: {
      amount: syntheticRedeem.amount,
      txid: syntheticRedeem.tx.txid,
      valid: syntheticRedeem.applied.decoded.valid,
      params: syntheticRedeem.applied.decoded,
      mempoolAccept: syntheticRedeem.tx.accept
    },
    oracleRelay: {
      txid: oracleRelay.tx.txid,
      valid: oracleRelay.applied.decoded.valid,
      stateHash: oracleRelay.stateHash,
      payloadHash: oracleRelay.payloadHash,
      contractBefore: oracleRelay.contractBefore,
      contractAfter: oracleRelay.contractAfter,
      mempoolAccept: oracleRelay.tx.accept
    },
    managedRedeem: {
      amount: managedRedeem.amount,
      txid: managedRedeem.tx.txid,
      valid: managedRedeem.applied.decoded.valid,
      params: managedRedeem.applied.decoded,
      mempoolAccept: managedRedeem.tx.accept
    },
    dlcSpend,
    balancesAfter
  };
  fs.mkdirSync(path.dirname(ARTIFACT_OUT), { recursive: true });
  fs.writeFileSync(ARTIFACT_OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ artifactPath: ARTIFACT_OUT, summary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
