const crypto = require('crypto');
const litecore = require('bitcore-lib-ltc');

const TxUtils = require('../src/txUtils');
const Types = require('../src/types');
const Logic = require('../src/logic');
const Activation = require('../src/activation');
const Encode = require('../src/txEncoder');
const OracleList = require('../src/oracle');
const PropertyList = require('../src/property');
const Channels = require('../src/channels');
const ClearList = require('../src/clearlist');
const { ProceduralRegistry } = require('../src/procedural');

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

function csv(raw, min = 0) {
  const arr = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (arr.length < min) throw new Error(`Expected at least ${min} CSV values`);
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

function randHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(Buffer.from(String(str), 'utf8')).digest('hex');
}

async function broadcastPayload(senderAddress, payload) {
  const utxo = await TxUtils.findSuitableUTXO(senderAddress, 2000);
  const privateKey = await TxUtils.client.dumpprivkey(senderAddress);
  const feeSats = 2000;
  const dust = 546;
  const inputSats = Math.round(Number(utxo.satoshis || 0));
  const changeSats = inputSats - feeSats;
  let tx = new litecore.Transaction()
    .from(utxo)
    .addData(payload)
    .fee(feeSats);
  if (changeSats > dust) {
    tx = tx.to(senderAddress, changeSats);
  }
  tx.sign(privateKey);
  return TxUtils.client.sendrawtransaction(tx.uncheckedSerialize());
}

async function applyTxNow(txid, senderAddress, blockHeight) {
  const tx = await TxUtils.getRawTransaction(txid);
  const opret = tx?.vout?.find((v) => v?.scriptPubKey?.type === 'nulldata');
  const parsed = parseTL(opret?.scriptPubKey?.hex || '');
  if (!parsed) throw new Error(`No TL payload for tx ${txid}`);

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
  if (decoded.valid !== true) {
    throw new Error(`tx invalid ${txid}: ${decoded.reason || 'unknown'}`);
  }
  await Logic.typeSwitch(parsed.type, decoded);
  return { type: parsed.type, decoded };
}

async function activateIfNeeded(adminAddress, txType, applyImmediate) {
  const activation = Activation.getInstance();
  const alreadyActive = await activation.isTxTypeActive(txType);
  if (alreadyActive) return null;
  const txid = await TxUtils.activationTransaction(adminAddress, txType);
  if (applyImmediate) {
    const block = await TxUtils.getBlockCount();
    await applyTxNow(txid, adminAddress, block);
  }
  return txid;
}

async function main() {
  const dryRun = benv('TL_DRY_RUN', false);
  const applyImmediate = benv('TL_APPLY_IMMEDIATE', true);

  const admin = env('TL_ADMIN_ADDRESS', 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');
  const oracleAdmin = env('TL_ORACLE_ADMIN_ADDRESS', admin);
  const refAddress = env('TL_REF_ADDRESS', 'tltc1q534ynyrk47eqvyrmu0wkfm2pavshz4sdemps2p');
  const recipients = csv(
    env(
      'TL_RECIPIENTS',
      'tltc1qu6d9h92vaztqtw48tum4gumcfsc0g335qlclm7,tltc1qx0eze93z2ym4mv7a8y8qw324l9c3hhjtl957mc,tltc1qvgddkmqqav5cnz2gxkzrapsuewcqmr4naapgxg'
    ),
    2
  );

  const channelAddress = env('TL_CHANNEL_ADDRESS', admin); // must be signable for live tx23/tx31
  const commitA = env('TL_COMMIT_A', 'tltc1q65vct5c7fp5znppasrgglj6axwqmzyppg0n0aw');
  const commitB = env('TL_COMMIT_B', 'tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t');

  const collateralPropertyId = nenv('TL_COLLATERAL_PROPERTY_ID', 1);
  const scalingPropertyId = nenv('TL_SCALING_PROPERTY_ID', 5);
  const depositAmount = nenv('TL_DEPOSIT_AMOUNT', 3);
  const transferAmounts = csv(env('TL_TRANSFER_AMOUNTS', '1,0.75,0.5')).map(Number);
  const tradeCount = Math.max(1, Math.trunc(nenv('TL_SCALING_TRADE_COUNT', 20)));
  const perTradeNet = nenv('TL_SCALING_NET_AMOUNT', 0.5);
  const oracleBasePrice = nenv('TL_ORACLE_BASE_PRICE', 100);
  const scalingBroadcast = benv('TL_SCALING_BROADCAST', false);

  const templateId = env('TL_DLC_TEMPLATE_ID', `tpl-utxo-wrap-${Date.now()}`);
  const contractId = env('TL_DLC_CONTRACT_ID', `ct-utxo-wrap-${Date.now()}`);
  const receiptTicker = env('TL_RECEIPT_TICKER', `D${Date.now().toString().slice(-5)}`);

  await TxUtils.init();
  const activation = Activation.getInstance();
  await activation.init();

  const net = await TxUtils.client.getBlockchainInfo();
  if (net.chain !== 'test') throw new Error(`Expected testnet, got ${net.chain}`);

  console.log('[dlc-proc-scaling] config', {
    dryRun,
    applyImmediate,
    admin,
    oracleAdmin,
    refAddress,
    recipients,
    channelAddress,
    commitA,
    commitB,
    collateralPropertyId,
    scalingPropertyId,
    depositAmount,
    tradeCount,
    perTradeNet,
    oracleBasePrice,
    scalingBroadcast
  });
  if (dryRun) return;

  const activations = [];
  for (const txType of [1, 2, 7, 9, 11, 13, 14, 23, 31]) {
    const txid = await activateIfNeeded(admin, txType, applyImmediate);
    activations.push({ txType, txid });
  }

  // 1) clearlist create + attest (for wrapper issuance/transfer gates)
  const clearlistId = await ClearList.getNextId();
  const wlTx = await broadcastPayload(admin, Encode.encodeCreateWhitelist({
    backupAddress: admin,
    name: `DLC-WL-${clearlistId}`,
    url: '',
    description: 'procedural utxo wrapper staging'
  }));
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(wlTx, admin, b);
  }
  const attestationTargets = [...new Set([admin, oracleAdmin, refAddress, ...recipients, commitA, commitB])];
  for (const addr of attestationTargets) {
    const attestTx = await TxUtils.createAttestTransaction(admin, {
      revoke: false,
      id: clearlistId,
      targetAddress: addr,
      metaData: 'CA'
    }, 9);
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(attestTx, admin, b);
    }
  }

  // 2) oracle create + publish baseline
  const createOracleTx = await broadcastPayload(oracleAdmin, Encode.encodeCreateOracle({
    ticker: 'DLCPRICE',
    url: '',
    backupAddress: '',
    whitelists: [],
    lag: 1
  }));
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(createOracleTx, oracleAdmin, b);
  }
  const oracles = await OracleList.getAllOracles();
  const newestOracle = oracles.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  const oracleId = Number(newestOracle?.id || 0);
  if (!oracleId) throw new Error('Failed to resolve oracleId');

  const priceOpenTx = await TxUtils.publishDataTransaction(oracleAdmin, {
    oracleid: oracleId,
    price: oracleBasePrice
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(priceOpenTx, oracleAdmin, b);
  }

  // 3) procedural token issue constrained to clearlist
  const issueTx = await broadcastPayload(admin, Encode.encodeTokenIssue({
    initialAmount: 1,
    ticker: receiptTicker,
    whitelists: [clearlistId],
    managed: true,
    backupAddress: '',
    nft: false,
    coloredCoinHybrid: false,
    proceduralType: 1
  }));
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(issueTx, admin, b);
  }
  const props = await PropertyList.getPropertyIndex();
  const receipt = props.find((p) => p.ticker === receiptTicker);
  const receiptPropertyId = Number(receipt?.id || 0);
  if (!receiptPropertyId) throw new Error(`Failed to resolve receipt property for ${receiptTicker}`);

  // 4) template/contract with published hash
  const templateHash = sha256Hex(JSON.stringify({
    templateId,
    oracleId,
    collateralPropertyId,
    receiptPropertyId,
    clearlistId,
    refAddress
  }));
  await ProceduralRegistry.upsertTemplate(templateId, {
    oracleId,
    collateralPropertyId,
    receiptPropertyId,
    clearlistId,
    refAddress,
    templateHash
  });
  await ProceduralRegistry.upsertContract(contractId, templateId, 'FUNDED', {
    live: true,
    refAddress
  });

  // 5) deposit collateral to ref address + mint wrapper to ref with dlcHash
  const depositTx = await TxUtils.sendTransaction(admin, refAddress, collateralPropertyId, depositAmount, false);
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(depositTx, admin, b);
  }

  const grantTx = await TxUtils.createGrantManagedTokenTransaction(admin, {
    propertyId: receiptPropertyId,
    amountGranted: depositAmount,
    addressToGrantTo: refAddress,
    dlcTemplateId: templateId,
    dlcContractId: contractId,
    settlementState: 'FUNDED',
    dlcHash: templateHash
  });
  if (applyImmediate) {
    const b = await TxUtils.getBlockCount();
    await applyTxNow(grantTx, admin, b);
  }

  // 6) transfer wrapped token from ref to multiple addresses
  const transferTxids = [];
  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    const amt = Number(transferAmounts[i] ?? transferAmounts[transferAmounts.length - 1] ?? 0.5);
    const txid = await TxUtils.sendTransaction(refAddress, to, receiptPropertyId, amt, false);
    transferTxids.push({ to, amt, txid });
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(txid, refAddress, b);
    }
  }

  // 7) stage signable channel for scaling tx23/tx31 and run 20 L2 settlements
  const startBlock = await TxUtils.getBlockCount();
  await Channels.setChannel(channelAddress, {
    channel: channelAddress,
    participants: { A: commitA, B: commitB },
    commits: [],
    A: { [String(scalingPropertyId)]: 25 },
    B: { [String(scalingPropertyId)]: 120 },
    clearLists: { A: [clearlistId], B: [clearlistId] },
    payEnabled: { A: false, B: false },
    lastCommitmentTime: startBlock,
    lastUsedColumn: 'B',
    channelPubkeys: { A: '', B: '' }
  });

  const l2Settles = [];
  for (let i = 0; i < tradeCount; i++) {
    const pct = ((i % 20) - 10) / 100; // [-10%, +9%]
    const markPrice = Number((oracleBasePrice * (1 + pct)).toFixed(4));
    const b = await TxUtils.getBlockCount();
    const settleParams = {
      settleType: 2, // NET_SETTLE
      txidNeutralized1: randHex(32),
      txidNeutralized2: '',
      markPrice,
      columnAIsSeller: false, // payer side B in this staged channel
      columnAIsMaker: true,
      netAmount: perTradeNet,
      propertyId: scalingPropertyId,
      expiryBlock: b + 200
    };

    if (scalingBroadcast) {
      const oracleTickTx = await TxUtils.publishDataTransaction(oracleAdmin, {
        oracleid: oracleId,
        price: markPrice
      });
      if (applyImmediate) {
        await applyTxNow(oracleTickTx, oracleAdmin, b);
      }

      const settleTx = await TxUtils.createSettleChannelPNLTransaction(channelAddress, settleParams);
      if (applyImmediate) {
        await applyTxNow(settleTx, channelAddress, b);
      }
      l2Settles.push({ i, markPrice, txid: settleTx });
    } else {
      await Logic.publishOracleData(oracleId, markPrice, undefined, undefined, undefined, b);
      const syntheticTxid = `l2-net-${i}-${randHex(6)}`;
      await Logic.settleChannelPNL(channelAddress, settleParams, b, syntheticTxid);
      l2Settles.push({ i, markPrice, txid: syntheticTxid });
    }
  }

  const endBlock = await TxUtils.getBlockCount();
  const kingParams = {
    blockStart: Math.max(0, startBlock - 2),
    blockEnd: endBlock,
    propertyId: scalingPropertyId,
    netAmount: Math.max(1, Number((perTradeNet * 2).toFixed(8))),
    aPaysBDirection: false,
    channelRoot: randHex(32),
    totalContracts: tradeCount,
    neutralizedCount: tradeCount
  };
  let kingTx = null;
  if (scalingBroadcast) {
    kingTx = await TxUtils.createKingSettleTransaction(channelAddress, kingParams);
    if (applyImmediate) {
      const b = await TxUtils.getBlockCount();
      await applyTxNow(kingTx, channelAddress, b);
    }
  } else {
    kingTx = `l2-king-${randHex(8)}`;
    await Logic.batchSettlement({
      senderAddress: channelAddress,
      ...kingParams
    });
  }

  console.log('[dlc-proc-scaling] SUCCESS', {
    clearlistId,
    oracleId,
    receiptPropertyId,
    templateId,
    contractId,
    templateHash,
    activations,
    txids: {
      wlTx,
      createOracleTx,
      priceOpenTx,
      issueTx,
      depositTx,
      grantTx,
      kingTx
    },
    transferTxids,
    l2Count: l2Settles.length,
    l2First: l2Settles[0],
    l2Last: l2Settles[l2Settles.length - 1]
  });
}

main().catch((err) => {
  console.error('[dlc-proc-scaling] failed:', err.message || err);
  process.exit(1);
});
