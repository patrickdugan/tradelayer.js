/**
 * Live helper: publish the canonical daily address state blob into tx30 relayBlob.
 *
 * Required env:
 * - TL_ORACLE_ID
 * - TL_ORACLE_ADMIN_ADDRESS
 * - TL_DLC_CONTRACT_ID
 * - TL_STATE_PROPERTY_ID
 * - TL_STATE_ADDRESSES (csv)
 *
 * Optional env:
 * - TL_STATE_BUCKET_SIZE (default 1)
 * - TL_STATE_FROM_BLOCK (default current block - 1)
 * - TL_STATE_TO_BLOCK (default current block)
 * - TL_STATE_INCLUDE_ZERO=true|false (default false)
 * - TL_STATE_OMIT_NOOP=true|false (default true)
 * - TL_STATE_INCLUDE_OPS=issue,send,redeem,rpnl
 * - TL_DRY_RUN=true|false (default true)
 * - TL_APPLY_IMMEDIATE=true|false (default true)
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const { buildAddressDailyPayload, encodeBalancePayload, payloadHashFromB64 } = require('../src/stateOracle');
const { createOracleSigner } = require('./makeshiftOracle');

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : String(v);
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
function csv(raw) {
  return String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function parseTL(scriptHex) {
  const markerHex = '746c';
  const pos = String(scriptHex || '').indexOf(markerHex);
  if (pos < 0) return null;
  const ascii = Buffer.from(scriptHex.slice(pos), 'hex').toString();
  if (!ascii.startsWith('tl')) return null;
  const type = parseInt(ascii.slice(2, 3), 36);
  if (!Number.isFinite(type)) return null;
  return { marker: 'tl', type, encodedPayload: ascii.slice(3) };
}

async function applyTxNow(txid, senderAddress, blockHeight) {
  const tx = await TxUtils.getRawTransaction(txid);
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTL(opret?.scriptPubKey?.hex || '');
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
  if (decoded.valid !== true) throw new Error(`tx invalid ${txid}: ${decoded.reason || 'unknown'}`);
  await Logic.typeSwitch(parsed.type, decoded);
}

async function main() {
  const dryRun = benv('TL_DRY_RUN', true);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const oracleId = nenv('TL_ORACLE_ID', 0);
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS');
  const dlcRef = env('TL_DLC_CONTRACT_ID');
  const propertyId = nenv('TL_STATE_PROPERTY_ID', 0);
  const addresses = csv(env('TL_STATE_ADDRESSES'));
  const bucketSize = nenv('TL_STATE_BUCKET_SIZE', 1);
  const includeZero = benv('TL_STATE_INCLUDE_ZERO', false);
  const omitNoOpAddresses = benv('TL_STATE_OMIT_NOOP', true);
  const includeOps = csv(env('TL_STATE_INCLUDE_OPS', 'issue,send,redeem,rpnl'));

  if (!oracleId || !oracleAdmin || !dlcRef || !propertyId || addresses.length === 0) {
    throw new Error('Missing required env for state-oracle relay');
  }

  await TxUtils.init();
  const currentBlock = await TxUtils.getBlockCount();
  const fromBlock = nenv('TL_STATE_FROM_BLOCK', Math.max(0, currentBlock - 1));
  const toBlock = nenv('TL_STATE_TO_BLOCK', currentBlock);
  const payload = await buildAddressDailyPayload({
    propertyId,
    addresses,
    fromBlock,
    toBlock,
    bucketSize,
    includeZero,
    omitNoOpAddresses,
    includeOps
  });
  const balancePayloadB64 = encodeBalancePayload(payload);
  const payloadHash = payloadHashFromB64(balancePayloadB64);
  const stateHash = payloadHash;

  const signer = createOracleSigner();
  const signedBundle = signer.signBundle({
    eventId: `${dlcRef}-daily`,
    outcome: 'DAILY_STATE',
    outcomeIndex: 2,
    stateHash,
    payloadHash,
    timestamp: Math.floor(Date.now() / 1000)
  });
  const relayBlobDoc = {
    ...signedBundle,
    kind: 'daily',
    propertyId,
    windowStartBlock: payload.windowStartBlock,
    windowEndBlock: payload.windowEndBlock,
    blobRef: `${dlcRef}-daily-${payload.windowEndBlock}`,
    balancePayloadB64
  };
  const relayBlob = 'b64:' + Buffer.from(JSON.stringify(relayBlobDoc), 'utf8').toString('base64');

  console.log('[state-oracle-live] prepared', {
    oracleId,
    dlcRef,
    propertyId,
    bucketSize,
    fromBlock,
    toBlock,
    rows: payload.rows.length,
    payloadHash
  });
  console.log('[state-oracle-live] summary ' + JSON.stringify({
    oracleId,
    dlcRef,
    propertyId,
    bucketSize,
    fromBlock,
    toBlock,
    rowCount: payload.rows.length,
    payloadHash,
    blobRef: relayBlobDoc.blobRef,
    windowStartBlock: relayBlobDoc.windowStartBlock,
    windowEndBlock: relayBlobDoc.windowEndBlock,
    kind: relayBlobDoc.kind,
    stateHash
  }));
  if (dryRun) return;

  const txid = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId,
    relayType: 2,
    stateHash,
    dlcRef,
    settlementState: 'OPEN',
    relayBlob,
    autoRoll: false,
    nextDlcRef: ''
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(txid, oracleAdmin, b);
  }
  console.log('[state-oracle-live] txid', txid);
}

main().catch((e) => {
  console.error('[state-oracle-live] failed:', e.message || e);
  process.exit(1);
});
