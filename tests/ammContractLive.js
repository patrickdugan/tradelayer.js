/**
 * Live AMM contract-pool harness (tx type 10).
 *
 * Runs:
 * 1) optional activation of tx 10
 * 2) add liquidity to contract AMM
 * 3) redeem liquidity from contract AMM
 * 4) print AMM state + LP balances
 *
 * Env:
 * - WALLET_NAME=wallet.dat
 * - TL_ADMIN_ADDRESS
 * - TL_SERIES_ID (default 3)
 * - TL_AMM_AMOUNT (default 1)
 * - TL_APPLY_IMMEDIATE=true|false (default true)
 * - TL_ACTIVATE_AMM_TX=true|false (default true)
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const ContractRegistry = require('../src/contractRegistry');
const Tally = require('../src/tally');

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
  if (decoded.valid !== true) throw new Error(`invalid tx ${txid}: ${decoded.reason || 'unknown'}`);
  await Logic.typeSwitch(parsed.type, decoded);
}

async function snapshot(admin, seriesId) {
  const info = await ContractRegistry.getContractInfo(seriesId);
  const amm = info?.ammPool || {};
  const tBase = await Tally.getTally(admin, seriesId);
  const tLP = await Tally.getTally(admin, `${seriesId}-LP`);
  return {
    position: Number(amm.position || 0),
    lpShares: { ...(amm.lpAddresses || {}) },
    baseBalance: Number(tBase?.available || 0),
    lpBalance: Number(tLP?.available || 0)
  };
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const seriesId = nenv('TL_SERIES_ID', 3);
  const amount = nenv('TL_AMM_AMOUNT', 1);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);
  const activate = benv('TL_ACTIVATE_AMM_TX', true);

  await TxUtils.init();
  await Activation.getInstance().init();
  const block = await TxUtils.getBlockCount();

  console.log('[amm-live] config', { admin, seriesId, amount, block, applyImmediate, activate });

  if (activate) {
    const actTx = await TxUtils.activationTransaction(admin, 10);
    if (applyImmediate) await applyTxNow(actTx, admin, block);
    console.log('[amm-live] activation tx', actTx);
  }

  const before = await snapshot(admin, seriesId);
  console.log('[amm-live] before', before);

  const addTx = await TxUtils.createAMMPoolTransaction(admin, {
    isRedeem: 0,
    isContract: 1,
    id: seriesId,
    amount,
    id2: 0,
    amount2: 0
  });
  if (applyImmediate) await applyTxNow(addTx, admin, block);
  console.log('[amm-live] add tx', addTx);

  const afterAdd = await snapshot(admin, seriesId);
  console.log('[amm-live] after add', afterAdd);

  const redeemTx = await TxUtils.createAMMPoolTransaction(admin, {
    isRedeem: 1,
    isContract: 1,
    id: seriesId,
    amount,
    id2: 0,
    amount2: 0
  });
  if (applyImmediate) await applyTxNow(redeemTx, admin, block);
  console.log('[amm-live] redeem tx', redeemTx);

  const afterRedeem = await snapshot(admin, seriesId);
  console.log('[amm-live] after redeem', afterRedeem);

  console.log('[amm-live] SUCCESS');
}

main().catch((e) => {
  console.error('[amm-live] failed:', e.message || e);
  process.exit(1);
});

