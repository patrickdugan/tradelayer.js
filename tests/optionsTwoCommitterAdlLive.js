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
const ClearList = require('../src/clearlist');
const OracleList = require('../src/oracle');

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableRpcErr(err) {
  const msg = String(err?.message || err || '').toUpperCase();
  return (
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('SOCKET') ||
    msg.includes('TIMEOUT')
  );
}

async function withRetry(label, fn) {
  const attempts = nenv('TL_RPC_RETRIES', 6);
  const waitMs = nenv('TL_RPC_RETRY_MS', 4000);
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryableRpcErr(e) || i === attempts) break;
      console.log(`[retry] ${label} attempt=${i}/${attempts} err=${e.message || e}`);
      await sleep(waitMs);
    }
  }
  throw last;
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
  const tx = await withRetry(`getRawTransaction ${txid}`, async () => TxUtils.getRawTransaction(txid));
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const scriptHex = opret?.scriptPubKey?.hex;
  if (!scriptHex) throw new Error(`No OP_RETURN payload found for ${txid}`);
  const parsed = extractTlPayloadFromHex(scriptHex);
  if (!parsed) throw new Error(`No TL payload marker found for ${txid}`);
  const decoded = await withRetry(`decodePayload ${txid}`, async () => Types.decodePayload(
    txid,
    parsed.type,
    parsed.marker,
    parsed.encodedPayload,
    senderAddress,
    null,
    0,
    0,
    blockHeight
  ));
  decoded.block = blockHeight;
  if (decoded.valid !== true) throw new Error(`Immediate apply invalid tx ${txid}: ${decoded.reason || 'unknown'}`);
  await withRetry(`typeSwitch ${txid}`, async () => Logic.typeSwitch(parsed.type, decoded));
  return parsed.type;
}

async function publishOracle(admin, oracleId, price, applyImmediate, forcedBlock = null) {
  const txid = await withRetry(`publishOracle ${price}`, async () => TxUtils.publishDataTransaction(admin, { oracleid: oracleId, price }));
  if (applyImmediate) {
    const tip = await withRetry('getBlockCount publish', async () => TxUtils.getBlockCount());
    const applyBlock = Number.isFinite(forcedBlock) ? forcedBlock : tip;
    await applyTxNow(txid, admin, applyBlock);
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
    await withRetry(`fund ${a}`, async () => fundAddress(a, 0.02));
    await withRetry(`fund ${b}`, async () => fundAddress(b, 0.02));

    const sendATx = await withRetry(`send token A ${a}`, async () => TxUtils.sendTransaction(admin, a, collateralId, commitAmount, 0));
    const sendBTx = await withRetry(`send token B ${b}`, async () => TxUtils.sendTransaction(admin, b, collateralId, commitAmount, 0));
    if (!sendATx || String(sendATx).startsWith('Error')) throw new Error(`sendATx failed: ${sendATx}`);
    if (!sendBTx || String(sendBTx).startsWith('Error')) throw new Error(`sendBTx failed: ${sendBTx}`);
    if (applyImmediate) {
      const tip = await withRetry('getBlockCount send token', async () => TxUtils.getBlockCount());
      await applyTxNow(sendATx, admin, tip);
      await applyTxNow(sendBTx, admin, tip);
    }
  }

  const skipOnchainCommitSetup = String(process.env.TL_SKIP_ONCHAIN_COMMIT_SETUP || 'true').toLowerCase() === 'true';
  let ch;
  try {
    if (skipOnchainCommitSetup) throw new Error('on-chain commit setup skipped by TL_SKIP_ONCHAIN_COMMIT_SETUP');
    const cATx = await withRetry(`commit A ${a}`, async () => TxUtils.createCommitTransaction(a, {
      propertyId: collateralId,
      amount: commitAmount,
      channelAddress: channel,
      payEnabled: false,
      clearLists: []
    }));
    const cBTx = await withRetry(`commit B ${b}`, async () => TxUtils.createCommitTransaction(b, {
      propertyId: collateralId,
      amount: commitAmount,
      channelAddress: channel,
      payEnabled: false,
      clearLists: []
    }));
    if (applyImmediate) {
      const tip = await withRetry('getBlockCount commit', async () => TxUtils.getBlockCount());
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
        lastCommitmentTime: await withRetry('getBlockCount fallback channel init', async () => TxUtils.getBlockCount()),
        lastUsedColumn: null,
        channelPubkeys: { A: '', B: '' }
      };
    }
    cur.participants.A = a;
    cur.participants.B = b;
    cur.A[String(collateralId)] = Number((cur.A[String(collateralId)] || 0) + commitAmount);
    cur.B[String(collateralId)] = Number((cur.B[String(collateralId)] || 0) + commitAmount);
    cur.lastUsedColumn = 'B';
    cur.lastCommitmentTime = await withRetry('getBlockCount fallback channel save', async () => TxUtils.getBlockCount());
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

async function bootstrapAttestations(a, b) {
  const enabled = String(process.env.TL_BOOTSTRAP_ATTESTATIONS || 'true').toLowerCase() === 'true';
  if (!enabled) return;
  const cc = String(process.env.TL_ATTEST_COUNTRY || 'CA');
  const blk = await withRetry('getBlockCount attest', async () => TxUtils.getBlockCount());
  await ClearList.addAttestation(0, a, cc, blk);
  await ClearList.addAttestation(0, b, cc, blk);
}

async function bootstrapBalances(admin, a, b, collateralId, applyImmediate) {
  const amount = nenv('TL_BOOTSTRAP_BALANCE', 0);
  if (!(amount > 0)) return;
  const sendATx = await withRetry(`bootstrap send A ${a}`, async () => TxUtils.sendTransaction(admin, a, collateralId, amount, 0));
  const sendBTx = await withRetry(`bootstrap send B ${b}`, async () => TxUtils.sendTransaction(admin, b, collateralId, amount, 0));
  if (applyImmediate) {
    const tip = await withRetry('getBlockCount bootstrap send', async () => TxUtils.getBlockCount());
    await applyTxNow(sendATx, admin, tip);
    await applyTxNow(sendBTx, admin, tip);
  }
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
  const bPerpLong = String(process.env.TL_B_PERP_LONG || 'true').toLowerCase() === 'true';
  const startSpot = nenv('TL_SPOT_START', 108);
  const targets = splitNums('TL_SPOT_TARGETS', '113,118,123,128');
  const callStrike = nenv('TL_CALL_STRIKE', 120);
  const applyImmediate = String(process.env.TL_APPLY_IMMEDIATE || 'true').toLowerCase() === 'true';
  const runActivation = String(process.env.TL_RUN_ACTIVATION || 'false').toLowerCase() === 'true';
  const skipActivationInit = String(process.env.TL_SKIP_ACTIVATION_INIT || 'true').toLowerCase() === 'true';

  await withRetry('TxUtils.init', async () => TxUtils.init());
  if (!skipActivationInit) {
    await withRetry('Activation.init', async () => Activation.getInstance().init());
  }

  if (runActivation) {
    for (const t of [4, 14, 19, 27]) {
      const txid = await withRetry(`activate ${t}`, async () => TxUtils.activationTransaction(admin, t));
      if (applyImmediate) {
        const tip = await withRetry('getBlockCount activate', async () => TxUtils.getBlockCount());
        await applyTxNow(txid, admin, tip);
      }
    }
  }

  const setup = await ensureTwoCommitters(admin, channel, collateralId, commitAmount, applyImmediate);
  await bootstrapAttestations(setup.commitA, setup.commitB);
  await bootstrapBalances(admin, setup.commitA, setup.commitB, collateralId, applyImmediate);
  console.log('[setup]', {
    channel,
    commitA: setup.commitA,
    commitB: setup.commitB,
    balances: {
      A: setup.channelState?.A?.[String(collateralId)] || 0,
      B: setup.channelState?.B?.[String(collateralId)] || 0
    }
  });

  let synthBlock = await withRetry('getBlockCount synth start', async () => TxUtils.getBlockCount());
  await publishOracle(admin, oracleId, startSpot, applyImmediate, ++synthBlock);
  const tradePxRaw = process.env.TL_TRADE_PRICE;
  const tradePrice = (tradePxRaw === undefined || tradePxRaw === null || tradePxRaw === '')
    ? Number(await OracleList.getOraclePrice(oracleId))
    : Number(tradePxRaw);

  const block = await withRetry('getBlockCount pre-trade', async () => TxUtils.getBlockCount());
  const expiry = block + 120;
  const callTicker = `${seriesId}-${expiry}-C-${callStrike}`;

  // Direction toggle:
  // - B long perp  => A seller => columnAIsSeller=true
  // - B short perp => A buyer  => columnAIsSeller=false
  const perpTx = await withRetry('create perp trade', async () => TxUtils.createChannelContractTradeTransaction(channel, {
    contractId: seriesId,
    price: tradePrice,
    amount: perpQty,
    columnAIsSeller: bPerpLong ? true : false,
    expiryBlock: expiry,
    insurance: false,
    columnAIsMaker: true
  }));
  if (applyImmediate) {
    try {
      await applyTxNow(perpTx, channel, block);
    } catch (e) {
      console.log('[warn] perp immediate-apply failed:', e.message || e);
    }
  }

  // B short call: A is buyer => columnAIsSeller=false
  const optionTx = await withRetry('create option trade', async () => TxUtils.createOptionTradeTransaction(channel, {
    contractId: callTicker,
    price: 0,
    amount: optQty,
    columnAIsSeller: false,
    expiryBlock: expiry,
    columnAIsMaker: true
  }));
  if (applyImmediate) {
    try {
      await applyTxNow(optionTx, channel, block);
    } catch (e) {
      console.log('[warn] option immediate-apply failed:', e.message || e);
    }
  }

  const ob = await Orderbook.getOrderbookInstance(seriesId);
  const forceEmptyBook = String(process.env.TL_FORCE_EMPTY_BOOK || 'false').toLowerCase() === 'true';
  if (forceEmptyBook) {
    const key = String(seriesId);
    if (!ob.orderBooks[key]) ob.orderBooks[key] = { buy: [], sell: [] };
    ob.orderBooks[key].buy = [];
    ob.orderBooks[key].sell = [];
    await ob.saveOrderBook(seriesId);
  }
  const side = ob?.orderBooks?.[String(seriesId)] || { buy: [], sell: [] };
  console.log('[orderbook-depth]', { buy: side.buy.length, sell: side.sell.length });

  for (const px of targets) {
    await publishOracle(admin, oracleId, px, applyImmediate, ++synthBlock);
    const h = await withRetry('getBlockCount loop', async () => TxUtils.getBlockCount());
    if (String(process.env.TL_SKIP_SUPPLY_CHECK || 'true').toLowerCase() === 'true') {
      const TallyMap = require('../src/tally');
      await TallyMap.setModFlag(false);
    }
    try {
      await withRetry(`clearing ${px}`, async () => Clearing.clearingFunction(h, true));
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
