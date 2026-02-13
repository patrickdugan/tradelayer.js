/**
 * Live two-committer setup + ADL/liquidation edge probe.
 *
 * Scenario:
 * 1) Build channel with two distinct committers (A/B) from wallet-owned addresses.
 * 2) Open covered-perp shape for B: B long perp + B short call.
 * 3) Push oracle up with no orderbook depth and run clearing.
 * 4) Report whether liquidation/ADL happened and whether B perp got zeroed.
 *
 * Env:
 * - WALLET_NAME=wallet.dat
 * - TL_APPLY_IMMEDIATE=true
 * - TL_ADMIN_ADDRESS=<default admin>
 * - TL_CHANNEL_ADDRESS=<default admin>
 * - TL_SERIES_ID=3
 * - TL_ORACLE_ID=2
 * - TL_COLLATERAL_ID=5
 * - TL_COMMIT_AMOUNT=25
 * - TL_PERP_QTY=1
 * - TL_OPTION_QTY=1
 * - TL_SPOT_START=108
 * - TL_SPOT_TARGETS=113,118,123,128
 * - TL_CALL_STRIKE=120
 */

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Channels = require('../src/channels');
const MarginMap = require('../src/marginMap');
const Clearing = require('../src/clearing');
const Orderbook = require('../src/orderbook');

function nenv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}=${raw}`);
  return n;
}

function splitNums(name, fallbackCsv) {
  const raw = process.env[name] || fallbackCsv;
  return String(raw).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
}

function extractTlPayloadFromHex(scriptHex) {
  const markerHex = '746c';
  const pos = scriptHex.indexOf(markerHex);
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
  const scriptHex = opret?.scriptPubKey?.hex;
  if (!scriptHex) throw new Error(`No OP_RETURN payload found for ${txid}`);
  const parsed = extractTlPayloadFromHex(scriptHex);
  if (!parsed) throw new Error(`No TL payload marker found for ${txid}`);
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
  if (decoded.valid !== true) throw new Error(`Immediate apply invalid tx ${txid}: ${decoded.reason || 'unknown'}`);
  await Logic.typeSwitch(parsed.type, decoded);
  return parsed.type;
}

async function publishOracle(admin, oracleId, price, applyImmediate) {
  const txid = await TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price });
  if (applyImmediate) {
    const tip = await TxUtils.getBlockCount();
    await applyTxNow(txid, admin, tip);
  }
  return txid;
}

async function fundAddress(addr, ltcAmount) {
  return TxUtils.client.rpcCall('sendtoaddress', [addr, ltcAmount], true);
}

async function walletNewAddress() {
  return TxUtils.client.rpcCall('getnewaddress', [], true);
}

async function ensureTwoCommitters(admin, channel, collateralId, commitAmount, applyImmediate) {
  const a = process.env.TL_COMMIT_A || await walletNewAddress();
  const b = process.env.TL_COMMIT_B || await walletNewAddress();
  const skipFund = String(process.env.TL_SKIP_FUNDING || 'true').toLowerCase() === 'true';

  if (!skipFund) {
    await fundAddress(a, 0.02);
    await fundAddress(b, 0.02);

    const sendATx = await TxUtils.sendTransaction(admin, a, collateralId, commitAmount, 0);
    const sendBTx = await TxUtils.sendTransaction(admin, b, collateralId, commitAmount, 0);
    if (!sendATx || String(sendATx).startsWith('Error')) throw new Error(`sendATx failed: ${sendATx}`);
    if (!sendBTx || String(sendBTx).startsWith('Error')) throw new Error(`sendBTx failed: ${sendBTx}`);
    if (applyImmediate) {
      const tip = await TxUtils.getBlockCount();
      await applyTxNow(sendATx, admin, tip);
      await applyTxNow(sendBTx, admin, tip);
    }
  }

  let ch;
  try {
    const cATx = await TxUtils.createCommitTransaction(a, {
      propertyId: collateralId,
      amount: commitAmount,
      channelAddress: channel,
      payEnabled: false,
      clearLists: []
    });
    const cBTx = await TxUtils.createCommitTransaction(b, {
      propertyId: collateralId,
      amount: commitAmount,
      channelAddress: channel,
      payEnabled: false,
      clearLists: []
    });
    if (applyImmediate) {
      const tip = await TxUtils.getBlockCount();
      await applyTxNow(cATx, a, tip);
      await applyTxNow(cBTx, b, tip);
    }
    ch = await Channels.getChannel(channel);
  } catch (e) {
    console.log('[warn] on-chain commit setup failed, using forced channel binding fallback:', e.message || e);
    await Channels.loadChannelsRegistry();
    let cur = await Channels.getChannel(channel);
    if (!cur) {
      cur = {
        participants: { A: '', B: '' },
        channel,
        commits: [],
        A: {},
        B: {},
        clearLists: { A: [], B: [] },
        payEnabled: { A: false, B: false },
        lastCommitmentTime: await TxUtils.getBlockCount(),
        lastUsedColumn: null,
        channelPubkeys: { A: '', B: '' }
      };
    }
    cur.participants.A = a;
    cur.participants.B = b;
    cur.A[String(collateralId)] = Number((cur.A[String(collateralId)] || 0) + commitAmount);
    cur.B[String(collateralId)] = Number((cur.B[String(collateralId)] || 0) + commitAmount);
    cur.lastUsedColumn = 'B';
    cur.lastCommitmentTime = await TxUtils.getBlockCount();
    Channels.channelsRegistry.set(channel, cur);
    await Channels.saveChannelsRegistry();
    ch = cur;
  }

  return {
    commitA: ch?.participants?.A || a,
    commitB: ch?.participants?.B || b,
    channelState: ch
  };
}

async function main() {
  const admin = process.env.TL_ADMIN_ADDRESS || 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
  const channel = process.env.TL_CHANNEL_ADDRESS || admin;
  const seriesId = nenv('TL_SERIES_ID', 3);
  const oracleId = nenv('TL_ORACLE_ID', 2);
  const collateralId = nenv('TL_COLLATERAL_ID', 5);
  const commitAmount = nenv('TL_COMMIT_AMOUNT', 25);
  const perpQty = nenv('TL_PERP_QTY', 1);
  const optQty = nenv('TL_OPTION_QTY', 1);
  const startSpot = nenv('TL_SPOT_START', 108);
  const targets = splitNums('TL_SPOT_TARGETS', '113,118,123,128');
  const callStrike = nenv('TL_CALL_STRIKE', 120);
  const applyImmediate = String(process.env.TL_APPLY_IMMEDIATE || 'true').toLowerCase() === 'true';
  const runActivation = String(process.env.TL_RUN_ACTIVATION || 'false').toLowerCase() === 'true';

  await TxUtils.init();
  await Activation.getInstance().init();

  if (runActivation) {
    for (const t of [4, 14, 19, 27]) {
      const txid = await TxUtils.activationTransaction(admin, t);
      if (applyImmediate) {
        const tip = await TxUtils.getBlockCount();
        await applyTxNow(txid, admin, tip);
      }
    }
  }

  const setup = await ensureTwoCommitters(admin, channel, collateralId, commitAmount, applyImmediate);
  console.log('[setup]', {
    channel,
    commitA: setup.commitA,
    commitB: setup.commitB,
    balances: {
      A: setup.channelState?.A?.[String(collateralId)] || 0,
      B: setup.channelState?.B?.[String(collateralId)] || 0
    }
  });

  await publishOracle(admin, oracleId, startSpot, applyImmediate);

  const block = await TxUtils.getBlockCount();
  const expiry = block + 120;
  const callTicker = `${seriesId}-${expiry}-C-${callStrike}`;

  // B long perp: A is seller => columnAIsSeller=true
  const perpTx = await TxUtils.createChannelContractTradeTransaction(channel, {
    contractId: seriesId,
    price: startSpot,
    amount: perpQty,
    columnAIsSeller: true,
    expiryBlock: expiry,
    insurance: false,
    columnAIsMaker: true
  });
  if (applyImmediate) {
    try {
      await applyTxNow(perpTx, channel, block);
    } catch (e) {
      console.log('[warn] perp immediate-apply failed:', e.message || e);
    }
  }

  // B short call: A is buyer => columnAIsSeller=false
  const optionTx = await TxUtils.createOptionTradeTransaction(channel, {
    contractId: callTicker,
    price: 0,
    amount: optQty,
    columnAIsSeller: false,
    expiryBlock: expiry,
    columnAIsMaker: true
  });
  if (applyImmediate) {
    try {
      await applyTxNow(optionTx, channel, block);
    } catch (e) {
      console.log('[warn] option immediate-apply failed:', e.message || e);
    }
  }

  const ob = await Orderbook.getOrderbookInstance(seriesId);
  const side = ob?.orderBooks?.[String(seriesId)] || { buy: [], sell: [] };
  console.log('[orderbook-depth]', { buy: side.buy.length, sell: side.sell.length });

  for (const px of targets) {
    await publishOracle(admin, oracleId, px, applyImmediate);
    const h = await TxUtils.getBlockCount();
    try {
      await Clearing.clearingFunction(h, true);
    } catch (e) {
      console.log('[clearing-error]', { spot: px, error: e.message || String(e) });
    }

    const mm = await MarginMap.getInstance(seriesId);
    const bPos = mm.margins.get(setup.commitB) || {};
    const liq = Clearing.getLiquidation(seriesId, setup.commitB) || null;
    const adlLike = Boolean(liq && Number(liq.totalDeleveraged || 0) > 0 && side.buy.length === 0 && side.sell.length === 0);
    console.log('[step]', {
      spot: px,
      bContracts: Number(bPos.contracts || 0),
      bOptions: bPos.options || {},
      liquidation: liq,
      adlLike
    });
  }
}

main().catch((e) => {
  console.error('optionsTwoCommitterAdlLive failed:', e.message || e);
  process.exit(1);
});
