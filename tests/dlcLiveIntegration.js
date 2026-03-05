/**
 * LTC testnet staging harness for DLC + state-oracle paths.
 *
 * This stages:
 * - tx activation (2/11/12/13/14/27/30)
 * - procedural receipt token issuance
 * - multi-depositor collateral movement (tLTC/property 1) into a vault address
 * - receipt token mint + transfer trading
 * - derivative option trade + option expiry settlement call
 * - good relay + bad relay attempt + fraud slash
 * - redemption burn + collateral release transfer
 *
 * Default mode is dry-run.
 *
 * Required env:
 * - TL_ADMIN_ADDRESS
 * - TL_ORACLE_ADMIN_ADDRESS
 * - TL_BAD_ORACLE_ADDRESS
 * - TL_CHALLENGER_ADDRESS
 * - TL_DEPOSITORS (comma-separated addresses, at least 2)
 *
 * Optional env:
 * - TL_DRY_RUN=true|false (default true)
 * - TL_APPLY_IMMEDIATE=true|false (default true)
 * - TL_COLLATERAL_PROPERTY_ID (default 1)
 * - TL_DLC_VAULT_ADDRESS (default TL_ADMIN_ADDRESS)
 * - TL_DLC_TEMPLATE_ID (default "tpl-live-1")
 * - TL_DLC_CONTRACT_ID (default "ct-live-1")
 * - TL_DLC_NEXT_CONTRACT_ID (default "ct-live-2")
 * - TL_RECEIPT_TICKER (default "DLCLV")
 * - TL_DEPOSIT_AMOUNTS (comma list, default "10,7")
 * - TL_TRADE_AMOUNT (default 2)
 * - TL_REDEEM_AMOUNT (default 1)
 * - TL_OPTION_SERIES_ID (default 3)
 * - TL_OPTION_TYPE (default P)
 * - TL_OPTION_STRIKE (default 120)
 * - TL_OPTION_AMOUNT (default 1)
 * - TL_OPTION_PRICE (default 1)
 * - TL_OPTION_EXPIRY_OFFSET (default 30)
 * - TL_ORACLE_SPOT_OPEN (default 108)
 * - TL_ORACLE_SPOT_SETTLE (default 100 for puts, 130 for calls)
 * - TL_BLOCKS_PER_DAY (default 144)
 */

const litecore = require('bitcore-lib-ltc');
const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const OracleList = require('../src/oracle');
const PropertyList = require('../src/property');
const Clearing = require('../src/clearing');
const Encode = require('../src/txEncoder');
const Channels = require('../src/channels');
const { ProceduralRegistry } = require('../src/procedural');
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
function parseCsv(raw, min = 0) {
  const arr = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (arr.length < min) throw new Error(`Expected at least ${min} CSV entries`);
  return arr;
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
  return { type: parsed.type, params: decoded };
}

async function broadcastPayload(senderAddress, payload) {
  const utxo = await TxUtils.findSuitableUTXO(senderAddress, 2000);
  const privateKey = await TxUtils.client.dumpprivkey(senderAddress);
  const tx = new litecore.Transaction()
    .from(utxo)
    .addData(payload)
    .change(senderAddress)
    .fee(2000);
  tx.sign(privateKey);
  return TxUtils.client.sendrawtransaction(tx.serialize());
}

async function activateIfNeeded(adminAddress, txType, applyImmediate) {
  const activation = Activation.getInstance();
  const alreadyActive = await activation.isTxTypeActive(txType);
  if (alreadyActive) {
    return null;
  }
  const txid = await TxUtils.activationTransaction(adminAddress, txType);
  if (applyImmediate) {
    const block = await TxUtils.getBlockCount();
    await applyTxNow(txid, adminAddress, block);
  }
  return txid;
}

async function main() {
  const dryRun = benv('TL_DRY_RUN', true);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);

  const admin = env('TL_ADMIN_ADDRESS');
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS');
  const badOracle = env('TL_BAD_ORACLE_ADDRESS');
  const challenger = env('TL_CHALLENGER_ADDRESS');
  const depositors = parseCsv(env('TL_DEPOSITORS'), 2);

  if (!admin || !oracleAdmin || !badOracle || !challenger) {
    throw new Error('Missing required admin/oracle/challenger env addresses');
  }

  const collateralPropertyId = nenv('TL_COLLATERAL_PROPERTY_ID', 1);
  const vaultAddress = env('TL_DLC_VAULT_ADDRESS', admin);
  const templateId = env('TL_DLC_TEMPLATE_ID', 'tpl-live-1');
  const templateHash = env('TL_DLC_TEMPLATE_HASH', 'tpl-live-1-hash');
  const contractId = env('TL_DLC_CONTRACT_ID', 'ct-live-1');
  const nextContractId = env('TL_DLC_NEXT_CONTRACT_ID', 'ct-live-2');
  const receiptTicker = env('TL_RECEIPT_TICKER', 'DLCLV');
  const depositAmts = parseCsv(env('TL_DEPOSIT_AMOUNTS', '10,7')).map(Number);
  const tradeAmount = nenv('TL_TRADE_AMOUNT', 2);
  const redeemAmount = nenv('TL_REDEEM_AMOUNT', 1);

  const optionSeriesId = nenv('TL_OPTION_SERIES_ID', 3);
  const optionSender = env('TL_OPTION_SENDER', admin);
  const optionType = env('TL_OPTION_TYPE', 'P').toUpperCase() === 'C' ? 'C' : 'P';
  const optionStrike = nenv('TL_OPTION_STRIKE', 120);
  const optionAmount = nenv('TL_OPTION_AMOUNT', 1);
  const optionPrice = nenv('TL_OPTION_PRICE', 1);
  const expiryOffset = nenv('TL_OPTION_EXPIRY_OFFSET', 30);
  const spotOpen = nenv('TL_ORACLE_SPOT_OPEN', 108);
  const spotSettle = nenv('TL_ORACLE_SPOT_SETTLE', optionType === 'P' ? 100 : 130);
  const blocksPerDay = nenv('TL_BLOCKS_PER_DAY', 144);

  await TxUtils.init();
  const activation = Activation.getInstance();
  await activation.init();

  const net = await TxUtils.client.getBlockchainInfo();
  const network = await TxUtils.client.getNetworkInfo();
  console.log('[dlc-live] network', { chain: net.chain, subversion: network.subversion, dryRun, applyImmediate });
  if (net.chain !== 'test') throw new Error(`Expected testnet chain, got ${net.chain}`);

  console.log('[dlc-live] config', {
    admin, oracleAdmin, badOracle, challenger, depositors, collateralPropertyId,
    vaultAddress, templateId, templateHash, contractId, nextContractId, receiptTicker,
    depositAmts, tradeAmount, redeemAmount, optionSender
  });
  if (dryRun) return;

  for (const txType of [2, 11, 12, 13, 14, 27, 30]) {
    const txid = await activateIfNeeded(admin, txType, applyImmediate);
    console.log(`[dlc-live] activated tx${txType}`, txid);
  }

  // 1) Create oracle and capture id.
  const createOraclePayload = Encode.encodeCreateOracle({
    ticker: 'DLCSTATE',
    url: '',
    backupAddress: '',
    whitelists: [],
    lag: 1
  });
  const createOracleTx = await broadcastPayload(oracleAdmin, createOraclePayload);
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(createOracleTx, oracleAdmin, b);
  }
  const allOracles = await OracleList.getAllOracles();
  const newest = allOracles.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  const oracleId = Number(newest?.id || 0);
  if (!oracleId) throw new Error('Failed to derive created oracleId');
  console.log('[dlc-live] oracleId', oracleId);

  // 2) Issue procedural receipt token.
  const issuePayload = Encode.encodeTokenIssue({
    // Protocol validity requires integer > 0 even for managed/procedural wrappers.
    initialAmount: 1,
    ticker: receiptTicker,
    whitelists: [],
    managed: true,
    backupAddress: '',
    nft: false,
    coloredCoinHybrid: false,
    proceduralType: 1
  });
  const issueTx = await broadcastPayload(admin, issuePayload);
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(issueTx, admin, b);
  }
  const props = await PropertyList.getPropertyIndex();
  const receipt = props.find((p) => p.ticker === receiptTicker);
  if (!receipt?.id) throw new Error(`Unable to locate issued property for ticker ${receiptTicker}`);
  const receiptPropertyId = Number(receipt.id);
  console.log('[dlc-live] receiptPropertyId', receiptPropertyId);

  await ProceduralRegistry.upsertTemplate(templateId, {
    oracleId,
    collateralPropertyId,
    receiptPropertyId,
    vaultAddress,
    templateHash
  });
  await ProceduralRegistry.upsertContract(contractId, templateId, 'FUNDED', { live: true });

  // 3) Stake bad oracle collateral for slash testing.
  const stakeTx = await TxUtils.createStakeFraudProofTransaction(badOracle, {
    action: 0,
    oracleId,
    stakedPropertyId: collateralPropertyId,
    amount: 5
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(stakeTx, badOracle, b);
  }

  // 4) Multi-depositor collateral movement + mint receipt token.
  for (let i = 0; i < depositors.length; i++) {
    const depositor = depositors[i];
    const amt = Number(depositAmts[i] ?? depositAmts[depositAmts.length - 1] ?? 1);

    const depTx = await TxUtils.sendTransaction(depositor, vaultAddress, collateralPropertyId, amt, false);
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(depTx, depositor, b);
    }

    const grantTx = await TxUtils.createGrantManagedTokenTransaction(admin, {
      propertyId: receiptPropertyId,
      amountGranted: amt,
      addressToGrantTo: depositor,
      dlcTemplateId: templateId,
      dlcContractId: contractId,
      settlementState: 'FUNDED',
      dlcHash: templateHash
    });
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(grantTx, admin, b);
    }
    console.log('[dlc-live] deposit+mint', { depositor, amt, depTx, grantTx });
  }

  // 5) Trade receipt token between first two depositors.
  let tradeTx = null;
  try {
    tradeTx = await TxUtils.sendTransaction(depositors[0], depositors[1], receiptPropertyId, tradeAmount, false);
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(tradeTx, depositors[0], b);
    }
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (/non-transferable/i.test(msg)) {
      console.log('[dlc-live] receipt trade skipped (policy-gated):', msg);
    } else {
      throw e;
    }
  }

  // 6) Derivatives trade + expiry settlement.
  const block = await TxUtils.getBlockCount();
  const expiryBlock = block + expiryOffset;
  const ticker = `${optionSeriesId}-${expiryBlock}-${optionType}-${optionStrike}`;
  // Keep option channel state isolated from long-lived historical channel entries.
  await Channels.setChannel(optionSender, {
    channel: optionSender,
    participants: { A: depositors[0], B: depositors[1] },
    commits: [],
    A: {},
    B: {},
    clearLists: { A: [], B: [] },
    payEnabled: { A: false, B: false },
    lastCommitmentTime: block,
    lastUsedColumn: 'A',
    channelPubkeys: { A: '', B: '' }
  });
  const optTx = await TxUtils.createOptionTradeTransaction(optionSender, {
    contractId: ticker,
    price: optionPrice,
    amount: optionAmount,
    columnAIsSeller: true,
    expiryBlock,
    columnAIsMaker: true
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(optTx, depositors[0], b);
  }
  const openOracleTx = await TxUtils.publishDataTransaction(oracleAdmin, { oracleid: oracleId, price: spotOpen });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(openOracleTx, oracleAdmin, b);
  }
  await Clearing.settleOptionExpiries(optionSeriesId, expiryBlock, spotSettle, blocksPerDay, `dlc-live-${Date.now()}`);
  console.log('[dlc-live] derivative staged', { ticker, optTx, openOracleTx });

  // 7) Good relay (with optional auto-roll).
  const signer = createOracleSigner();
  const relayBundle = signer.signBundle({
    eventId: `${contractId}-settle`,
    outcome: 'SETTLED',
    outcomeIndex: 1,
    stateHash: `s-${contractId}`,
    timestamp: Math.floor(Date.now() / 1000)
  });
  const relayTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId,
    relayType: 1,
    stateHash: relayBundle.stateHash,
    dlcRef: contractId,
    settlementState: 'SETTLED',
    // Keep payload compact for OP_RETURN size limits in live mode.
    relayBlob: '',
    autoRoll: true,
    nextDlcRef: nextContractId
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(relayTx, oracleAdmin, b);
  }

  // 8) Bad relay attempt (expected invalid on immediate apply), then slash.
  const badRelayTx = await TxUtils.createStakeFraudProofTransaction(oracleAdmin, {
    action: 2,
    oracleId,
    relayType: 1,
    stateHash: relayBundle.stateHash,
    dlcRef: contractId,
    settlementState: 'SETTLED',
    // Intentionally malformed compact bundle; should fail signature/path validation.
    relayBlob: '{}'
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    try {
      await applyTxNow(badRelayTx, oracleAdmin, b);
      console.warn('[dlc-live] unexpected: bad relay applied');
    } catch (e) {
      console.log('[dlc-live] bad relay correctly rejected:', e.message);
    }
  }

  const slashTx = await TxUtils.createStakeFraudProofTransaction(challenger, {
    action: 1,
    oracleId,
    accusedAddress: badOracle,
    amount: 2,
    // Keep compact to avoid oversized OP_RETURN + dust/change edge cases in live mode.
    evidenceHash: 'br1',
    stakedPropertyId: collateralPropertyId
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(slashTx, challenger, b);
  }

  // 9) User redemption (burn receipt token) + collateral release transfer from vault.
  const redeemTx = await TxUtils.createRedeemManagedTokenTransaction(depositors[1], {
    propertyId: receiptPropertyId,
    amountDestroyed: redeemAmount,
    dlcTemplateId: templateId,
    dlcContractId: contractId,
    settlementState: 'SETTLED'
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(redeemTx, depositors[1], b);
  }
  const releaseTx = await TxUtils.sendTransaction(vaultAddress, depositors[1], collateralPropertyId, redeemAmount, false);
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(releaseTx, vaultAddress, b);
  }

  console.log('[dlc-live] SUCCESS', {
    oracleId,
    receiptPropertyId,
    contractId,
    nextContractId,
    txids: { issueTx, stakeTx, tradeTx, optTx, relayTx, badRelayTx, slashTx, redeemTx, releaseTx }
  });
}

main().catch((err) => {
  console.error('[dlc-live] failed:', err.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
