/**
 * Live harness: tx30 Plan A BitVM cache + challenge hold-up on LTCTEST.
 *
 * Flow:
 * 1) relay settlement mode=bitvm_cache (lock loser PnL into cache)
 * 2) adversarial payout attempt should fail
 * 3) relay settlement mode=bitvm_challenge
 * 4) relay settlement mode=bitvm_resolve verdict=uphold (refund loser)
 * 5) payout attempt after uphold should still fail
 *
 * Example:
 * WALLET_NAME=wallet.dat RPC_WALLET=wallet.dat TL_APPLY_IMMEDIATE=true `
 * TL_ORACLE_ADMIN_ADDRESS=<addr> TL_LOSER_ADDRESS=<addr> TL_WINNER_ADDRESS=<addr> `
 * TL_CHALLENGER_ADDRESS=<addr> TL_BITVM_VERDICT=uphold|reject node tests/tx30BitvmPlanALive.js
 */

const crypto = require('crypto');
const fs = require('fs');
const secp = require('tiny-secp256k1');
const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const { computeBundleHash } = require('../src/bitvmBundle');

function env(name, fallback = '') {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function benv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function parseTl(scriptHex) {
  const markerHex = '746c';
  const pos = String(scriptHex || '').indexOf(markerHex);
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString();
  if (!ascii.startsWith('tl')) return null;
  const type = parseInt(ascii.slice(2, 3), 36);
  if (!Number.isFinite(type)) return null;
  return { marker: 'tl', type, encodedPayload: ascii.slice(3) };
}

async function decodeTxWithSender(txid, senderAddress, blockHeight) {
  const tx = await TxUtils.getRawTransaction(txid);
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTl(opret?.scriptPubKey?.hex || '');
  if (!parsed) throw new Error(`No TL payload found for tx ${txid}`);
  const decoded = await Types.decodePayload(
    txid,
    parsed.type,
    parsed.marker,
    parsed.encodedPayload,
    senderAddress,
    null,
    0,
    0,
    blockHeight
  );
  decoded.block = blockHeight;
  return { parsed, decoded };
}

async function applyTxNow(txid, senderAddress, blockHeight) {
  const { parsed, decoded } = await decodeTxWithSender(txid, senderAddress, blockHeight);
  if (decoded.valid !== true) {
    throw new Error(`tx invalid ${txid}: ${decoded.reason || 'unknown'}`);
  }
  await Logic.typeSwitch(parsed.type, decoded);
  return parsed.type;
}

async function expectApplyFail(txid, senderAddress, blockHeight, reasonRx) {
  try {
    await applyTxNow(txid, senderAddress, blockHeight);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (reasonRx && !reasonRx.test(msg)) {
      throw new Error(`Expected failure matching ${reasonRx}, got: ${msg}`);
    }
    return msg;
  }
  throw new Error(`Expected tx apply failure for ${txid}`);
}

async function activateTxType(admin, txType, applyImmediate, block) {
  const txid = await TxUtils.activationTransaction(admin, txType);
  if (applyImmediate) await applyTxNow(txid, admin, block);
  return txid;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function canonicalRelayMessage(bundle) {
  return JSON.stringify({
    eventId: String(bundle.eventId || ''),
    outcome: String(bundle.outcome || ''),
    outcomeIndex: Number(bundle.outcomeIndex || 0),
    stateHash: String(bundle.stateHash || ''),
    timestamp: Number(bundle.timestamp || 0)
  });
}

function getRelaySigningKey() {
  const raw = env('TL_ORACLE_RELAY_PRIVKEY', '').trim();
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    const key = Buffer.from(raw, 'hex');
    if (secp.isPrivate(key)) return key;
  }
  for (;;) {
    const key = crypto.randomBytes(32);
    if (secp.isPrivate(key)) return key;
  }
}

function relayBlob(settlement, stateHash, relayPrivkey) {
  const doc = {
    eventId: `bitvm-plan-a-${Date.now()}`,
    outcome: 'SETTLED',
    outcomeIndex: 0,
    stateHash: stateHash || settlement.stateHash || `state-${Date.now()}`,
    timestamp: Date.now(),
    settlement,
    oraclePubkeyHex: Buffer.from(secp.pointFromScalar(relayPrivkey, true)).toString('hex')
  };
  const msg = canonicalRelayMessage(doc);
  const msgHash = sha256(Buffer.from(msg, 'utf8'));
  doc.signatureHex = Buffer.from(secp.sign(msgHash, relayPrivkey)).toString('hex');
  return 'b64:' + Buffer.from(JSON.stringify(doc), 'utf8').toString('base64');
}

function resolveBundleForCache() {
  const requireBundle = String(process.env.TL_BITVM_REQUIRE_BUNDLE || '').trim() === '1';
  if (!requireBundle) return { bundleHash: '', bundlePath: '' };

  const explicitHash = env('TL_BITVM_BUNDLE_HASH', '').trim().toLowerCase();
  const bundlePath = env('TL_BITVM_BUNDLE_PATH', '').trim();
  if (explicitHash) return { bundleHash: explicitHash, bundlePath };

  const defaultPath = 'C:\\projects\\UTXORef\\UTXO-Ref\\bitvm3\\utxo_referee\\artifacts\\m1_challenge_bundle_latest.json';
  const effectivePath = bundlePath || defaultPath;
  const raw = fs.readFileSync(effectivePath, 'utf8');
  const parsed = JSON.parse(raw);
  const declared = String(parsed.bundleHash || '').trim().toLowerCase();
  const computed = String(computeBundleHash(parsed) || '').trim().toLowerCase();
  if (!declared) {
    throw new Error(`TL_BITVM_REQUIRE_BUNDLE=1 but bundle artifact has no bundleHash: ${effectivePath}`);
  }
  if (declared !== computed) {
    throw new Error(`TL_BITVM_REQUIRE_BUNDLE=1 but bundle artifact self-check failed: ${effectivePath}`);
  }
  return { bundleHash: declared, bundlePath: effectivePath };
}

async function main() {
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS') || env('TL_ADMIN_ADDRESS');
  const loser = env('TL_LOSER_ADDRESS', oracleAdmin);
  const winner = env('TL_WINNER_ADDRESS', oracleAdmin);
  const challenger = env('TL_CHALLENGER_ADDRESS', oracleAdmin);
  const propertyId = nenv('TL_PROPERTY_ID', 1);
  const amount = nenv('TL_BITVM_AMOUNT', 1);
  const challengeBlocks = nenv('TL_BITVM_CHALLENGE_BLOCKS', 6);
  const verdict = env('TL_BITVM_VERDICT', 'uphold').toLowerCase();
  const dlcRef = env('TL_DLC_REF', `ct-bitvm-${Date.now()}`);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const runActivation = benv('TL_RUN_ACTIVATION', true);
  const cacheId = env('TL_BITVM_CACHE_ID', crypto.randomBytes(32).toString('hex'));
  const cacheAddress = env('TL_BITVM_CACHE_ADDRESS', `BITVM_CACHE::${dlcRef}`);
  const relayPrivkey = getRelaySigningKey();
  const { bundleHash, bundlePath } = resolveBundleForCache();

  if (!oracleAdmin) {
    throw new Error('Missing TL_ORACLE_ADMIN_ADDRESS (or TL_ADMIN_ADDRESS fallback)');
  }
  if (!['uphold', 'reject'].includes(verdict)) {
    throw new Error(`Invalid TL_BITVM_VERDICT=${verdict} (expected uphold|reject)`);
  }

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();

  if (runActivation) {
    const a30 = await activateTxType(oracleAdmin, 30, applyImmediate, block);
    console.log('[bitvm-plan-a-live] activated tx30', a30);
  }

  console.log('[bitvm-plan-a-live] config', {
    oracleAdmin,
    loser,
    winner,
    challenger,
    propertyId,
    amount,
    challengeBlocks,
    verdict,
    cacheId,
    cacheAddress,
    dlcRef,
    requireBundle: String(process.env.TL_BITVM_REQUIRE_BUNDLE || '').trim() === '1',
    bundleHash: bundleHash || undefined,
    bundlePath: bundlePath || undefined
  });

  const cacheStateHash = `cache-${Date.now()}`;
  const cacheTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: nenv('TL_ORACLE_ID', 1),
    stakedPropertyId: propertyId,
    amount: 0,
    accusedAddress: '',
    evidenceHash: '',
    relayType: 1,
    stateHash: cacheStateHash,
    dlcRef,
    settlementState: 'SETTLED',
    relayBlob: relayBlob({
      mode: 'bitvm_cache',
      cacheId,
      propertyId,
      amount,
      fromAddress: loser,
      toAddress: winner,
      cacheAddress,
      challengeBlocks,
      bundleHash: bundleHash || undefined,
      bundlePath: bundlePath || undefined
    }, cacheStateHash, relayPrivkey)
  });
  if (applyImmediate) await applyTxNow(cacheTx, oracleAdmin, block);
  console.log('[bitvm-plan-a-live] cache lock tx', cacheTx);

  const scamStateHash = `scam-${Date.now()}`;
  const scamPayoutTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: nenv('TL_ORACLE_ID', 1),
    stakedPropertyId: propertyId,
    amount: 0,
    accusedAddress: '',
    evidenceHash: '',
    relayType: 1,
    stateHash: scamStateHash,
    dlcRef,
    settlementState: 'SETTLED',
    relayBlob: relayBlob({
      mode: 'bitvm_payout',
      cacheId,
      propertyId,
      amount,
      toAddress: env('TL_ATTACKER_ADDRESS', winner)
    }, scamStateHash, relayPrivkey)
  });
  const scamFail = applyImmediate
    ? await expectApplyFail(scamPayoutTx, oracleAdmin, block, /challenge window still open|challenged|mismatch/i)
    : 'not-applied';
  console.log('[bitvm-plan-a-live] early/scam payout rejected', { scamPayoutTx, reason: scamFail });

  const challengeStateHash = `challenge-${Date.now()}`;
  const challengeTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: nenv('TL_ORACLE_ID', 1),
    stakedPropertyId: propertyId,
    amount: 0,
    accusedAddress: '',
    evidenceHash: '',
    relayType: 1,
    stateHash: challengeStateHash,
    dlcRef,
    settlementState: 'DISPUTED',
    relayBlob: relayBlob({
      mode: 'bitvm_challenge',
      cacheId,
      challengerAddress: challenger,
      evidenceHash: `fraud-${Date.now().toString(16)}`
    }, challengeStateHash, relayPrivkey)
  });
  if (applyImmediate) await applyTxNow(challengeTx, oracleAdmin, block);
  console.log('[bitvm-plan-a-live] challenge tx', challengeTx);

  const resolveStateHash = `resolve-${Date.now()}`;
  const resolveTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: nenv('TL_ORACLE_ID', 1),
    stakedPropertyId: propertyId,
    amount: 0,
    accusedAddress: '',
    evidenceHash: '',
    relayType: 1,
    stateHash: resolveStateHash,
    dlcRef,
    settlementState: 'SETTLED',
    relayBlob: relayBlob({
      mode: 'bitvm_resolve',
      cacheId,
      verdict,
      resolverAddress: oracleAdmin,
      reason: 'challenge held'
    }, resolveStateHash, relayPrivkey)
  });
  if (applyImmediate) await applyTxNow(resolveTx, oracleAdmin, block);
  console.log(`[bitvm-plan-a-live] resolve(${verdict}) tx`, resolveTx);

  const blockedStateHash = `blocked-${Date.now()}`;
  const blockedPayoutTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId: nenv('TL_ORACLE_ID', 1),
    stakedPropertyId: propertyId,
    amount: 0,
    accusedAddress: '',
    evidenceHash: '',
    relayType: 1,
    stateHash: blockedStateHash,
    dlcRef,
    settlementState: 'SETTLED',
    relayBlob: relayBlob({
      mode: 'bitvm_payout',
      cacheId,
      propertyId,
      amount,
      toAddress: winner
    }, blockedStateHash, relayPrivkey)
  });
  let finalOutcome;
  if (applyImmediate) {
    if (verdict === 'uphold') {
      const blockedReason = await expectApplyFail(
        blockedPayoutTx,
        oracleAdmin,
        block,
        /challenge upheld; payout blocked|challenged; payout blocked/i
      );
      finalOutcome = { status: 'blocked', reason: blockedReason };
    } else {
      await applyTxNow(blockedPayoutTx, oracleAdmin, block);
      finalOutcome = { status: 'released' };
    }
  } else {
    finalOutcome = { status: 'not-applied' };
  }

  console.log('[bitvm-plan-a-live] SUCCESS', {
    cacheTx,
    scamPayoutTx,
    challengeTx,
    resolveTx,
    blockedPayoutTx,
    finalOutcome,
    cacheId
  });
}

main().catch((e) => {
  console.error('[bitvm-plan-a-live] failed:', e.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
