/**
 * Live harness for tx23/tx31 scaling settlement paths.
 *
 * Goals:
 * - Broadcast and apply valid tx23 (KEEP_ALIVE + NET_SETTLE) and tx31 (KING_SETTLE)
 * - Stage adversarial attempts that must fail validation
 *   - non-channel sender trying to apply settlement payload
 *   - malformed tx23 missing required fields
 *   - tx23 king route without channelRoot
 *
 * Typical:
 * WALLET_NAME=wallet.dat TL_APPLY_IMMEDIATE=true node tests/scalingSettlementLive.js
 */

const crypto = require('crypto');
const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Channels = require('../src/channels');

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

async function tryDecodeAs(txid, senderAddress, blockHeight) {
  try {
    const { decoded } = await decodeTxWithSender(txid, senderAddress, blockHeight);
    return { ok: decoded.valid === true, reason: decoded.reason || '' };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e || '') };
  }
}

function randHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function activateTxType(admin, txType, applyImmediate, block) {
  const txid = await TxUtils.activationTransaction(admin, txType);
  if (applyImmediate) await applyTxNow(txid, admin, block);
  return txid;
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const propertyId = nenv('TL_PROPERTY_ID', 5);
  const desiredNetAmount = Math.max(0, nenv('TL_NET_AMOUNT', 1));
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const runActivation = benv('TL_RUN_ACTIVATION', true);
  const runAdversarial = benv('TL_RUN_ADVERSARIAL', true);

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();

  if (runActivation) {
    const a23 = await activateTxType(admin, 23, applyImmediate, block);
    const a31 = await activateTxType(admin, 31, applyImmediate, block);
    console.log('[scaling-live] activated', { a23, a31 });
  }

  const ch = await Channels.getChannel(channel);
  if (!ch) throw new Error(`Channel not found for ${channel}`);
  const commitA = ch?.participants?.A || null;
  const commitB = ch?.participants?.B || null;
  const balA = Number(ch?.A?.[String(propertyId)] || 0);
  const balB = Number(ch?.B?.[String(propertyId)] || 0);
  const canA = balA >= desiredNetAmount;
  const canB = balB >= desiredNetAmount;

  let netAmount = desiredNetAmount;
  let columnAIsSeller = true;
  let aPaysBDirection = true;
  if (canA) {
    columnAIsSeller = true;
    aPaysBDirection = true;
  } else if (canB) {
    columnAIsSeller = false;
    aPaysBDirection = false;
  } else {
    netAmount = 0;
    columnAIsSeller = true;
    aPaysBDirection = true;
  }

  const txidNeutralized1 = randHex(32);
  const txidNeutralized2 = randHex(32);

  console.log('[scaling-live] config', {
    admin,
    channel,
    propertyId,
    block,
    applyImmediate,
    balances: { A: balA, B: balB },
    chosen: { netAmount, columnAIsSeller, aPaysBDirection },
    participants: { commitA, commitB }
  });

  const keepAliveTx = await TxUtils.createSettleChannelPNLTransaction(channel, {
    settleType: 0,
    txidNeutralized1,
    txidNeutralized2: '',
    markPrice: 0,
    columnAIsSeller: false,
    columnAIsMaker: true,
    netAmount: 0,
    expiryBlock: block + 60
  });
  if (applyImmediate) await applyTxNow(keepAliveTx, channel, block);
  console.log('[scaling-live] keepAlive ok', keepAliveTx);

  const netSettleTx = await TxUtils.createSettleChannelPNLTransaction(channel, {
    settleType: 2,
    txidNeutralized1: keepAliveTx,
    txidNeutralized2: '',
    markPrice: 0,
    columnAIsSeller,
    columnAIsMaker: true,
    netAmount,
    propertyId,
    expiryBlock: block + 60
  });
  if (applyImmediate) await applyTxNow(netSettleTx, channel, block);
  console.log('[scaling-live] netSettle ok', netSettleTx);

  let kingTx = null;
  let kingApplied = false;
  let kingSkipReason = '';
  try {
    kingTx = await TxUtils.createKingSettleTransaction(channel, {
      blockStart: Math.max(0, block - 5),
      blockEnd: block,
      propertyId,
      netAmount,
      aPaysBDirection,
      channelRoot: randHex(32),
      totalContracts: 1,
      neutralizedCount: 0
    });
    if (applyImmediate) await applyTxNow(kingTx, channel, block);
    kingApplied = true;
    console.log('[scaling-live] kingSettle ok', kingTx);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (msg.includes('Tx type not yet activated')) {
      kingSkipReason = msg;
      console.log('[scaling-live] kingSettle skipped (activation missing)', msg);
    } else {
      throw e;
    }
  }

  if (runAdversarial) {
    const badMissingTxRef = await TxUtils.createSettleChannelPNLTransaction(channel, {
      settleType: 0,
      txidNeutralized1: '',
      txidNeutralized2: '',
      markPrice: 0,
      columnAIsSeller: false,
      columnAIsMaker: true,
      netAmount: 0,
      expiryBlock: block + 10
    });
    const badRefRes = await tryDecodeAs(badMissingTxRef, channel, block);
    if (badRefRes.ok) throw new Error('Expected reject for missing txidNeutralized1');
    console.log('[scaling-live] adversarial missing-ref rejected', badRefRes.reason);

    const badKingNoRoot = await TxUtils.createSettleChannelPNLTransaction(channel, {
      settleType: 3,
      txidNeutralized1,
      txidNeutralized2,
      markPrice: 0,
      columnAIsSeller,
      columnAIsMaker: true,
      netAmount,
      expiryBlock: block + 10,
      blockStart: Math.max(0, block - 2),
      blockEnd: block,
      propertyId,
      aPaysBDirection,
      channelRoot: ''
    });
    const badKingRes = await tryDecodeAs(badKingNoRoot, channel, block);
    if (badKingRes.ok) throw new Error('Expected reject for tx23 king-settle without channelRoot');
    console.log('[scaling-live] adversarial missing-channelRoot rejected', badKingRes.reason);

    const rogueSender = process.env.TL_ROGUE_SENDER || (await TxUtils.client.rpcCall('getnewaddress', [], true));
    const rogueRes = await tryDecodeAs(keepAliveTx, rogueSender, block);
    if (rogueRes.ok) throw new Error('Expected reject for rogue sender applying channel settlement');
    console.log('[scaling-live] adversarial rogue-sender rejected', { rogueSender, reason: rogueRes.reason });

    if (commitA) {
      const commitARes = await tryDecodeAs(keepAliveTx, commitA, block);
      if (commitARes.ok) throw new Error('Expected reject for committer direct sender (non-channel address)');
      console.log('[scaling-live] adversarial committer direct-sender rejected', { commitA, reason: commitARes.reason });
    }
  }

  console.log('[scaling-live] SUCCESS', {
    keepAliveTx,
    netSettleTx,
    kingTx,
    kingApplied,
    kingSkipReason
  });
}

main().catch((e) => {
  console.error('[scaling-live] failed:', e.message || e);
  process.exit(1);
});
