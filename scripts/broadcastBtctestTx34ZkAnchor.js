#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const Encode = require('../src/txEncoder');
const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const ZkWasmVerifier = require('../src/zkWasmVerifier');
const ZkEnvelopeResolver = require('../src/zkEnvelopeResolver');
const ProtectedUtxos = require('../src/protectedUtxoRegistry');
const { DEFAULT_BTCTEST_ADMIN_ADDRESS } = require('./testnetActivationProfile');

const DEFAULT_WALLET = 'utxoref-testnet';
const OP_RETURN_LIMIT = 80;
const DEFAULT_LIVE_RECEIPT = path.join('artifacts', 'zk_signed_channel_transfer', 'signed_channel_transfer_live_result_latest.json');
const DEFAULT_ARTIFACT = path.join('artifacts', 'btctest-tx34-zk-anchor-latest.json');

function parseArgs(argv) {
  const out = {
    bitcoinBin: process.env.BITCOIN_BIN || '',
    datadir: process.env.BTCTEST_DATADIR || '',
    wallet: process.env.BTCTEST_WALLET || DEFAULT_WALLET,
    adminAddress: process.env.TL_ADMIN_ADDRESS || DEFAULT_BTCTEST_ADMIN_ADDRESS,
    liveReceipt: process.env.TL_ZK_LIVE_RECEIPT || DEFAULT_LIVE_RECEIPT,
    artifact: process.env.TL_BTCTEST_TX34_ARTIFACT || DEFAULT_ARTIFACT,
    protectedRegistry: ProtectedUtxos.defaultRegistryPath(),
    feeSats: Number(process.env.TL_BTCTEST_TX34_FEE_SATS || 546),
    allowWalletCoinSelection: false,
    ignoreProtectedUtxos: false,
    dryRun: false
  };

  for (const arg of argv) {
    if (arg.startsWith('--bitcoin-bin=')) out.bitcoinBin = arg.slice('--bitcoin-bin='.length);
    else if (arg.startsWith('--datadir=')) out.datadir = arg.slice('--datadir='.length);
    else if (arg.startsWith('--wallet=')) out.wallet = arg.slice('--wallet='.length);
    else if (arg.startsWith('--admin=')) out.adminAddress = arg.slice('--admin='.length);
    else if (arg.startsWith('--receipt=')) out.liveReceipt = arg.slice('--receipt='.length);
    else if (arg.startsWith('--artifact=')) out.artifact = arg.slice('--artifact='.length);
    else if (arg.startsWith('--protected-registry=')) out.protectedRegistry = arg.slice('--protected-registry='.length);
    else if (arg.startsWith('--fee-sats=')) out.feeSats = Number(arg.slice('--fee-sats='.length));
    else if (arg === '--allow-wallet-coin-selection') out.allowWalletCoinSelection = true;
    else if (arg === '--ignore-protected-utxos') out.ignoreProtectedUtxos = true;
    else if (arg === '--dry-run') out.dryRun = true;
  }
  if (!Number.isSafeInteger(out.feeSats) || out.feeSats <= 0) throw new Error(`invalid fee sats: ${out.feeSats}`);

  return out;
}

function asciiHex(value) {
  return Buffer.from(String(value), 'utf8').toString('hex');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function portablePath(value) {
  const text = String(value || '');
  if (!text) return text;
  if (/^[a-z]:\\/i.test(text)) {
    const relative = path.relative(process.cwd(), text);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  }
  return text;
}

function ensureTlPayload(txType, encoded) {
  if (String(encoded).startsWith('tl')) return encoded;
  return `tl${Number(txType).toString(36)}${encoded}`;
}

function btcToSats(value) {
  const text = String(value);
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole || '0') * 100000000n) + BigInt((fraction + '00000000').slice(0, 8));
}

function satsToBtcString(value) {
  const sats = BigInt(value);
  const whole = sats / 100000000n;
  const fraction = (sats % 100000000n).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

function cliPath(bitcoinBin) {
  if (bitcoinBin) return path.join(bitcoinBin, process.platform === 'win32' ? 'bitcoin-cli.exe' : 'bitcoin-cli');
  return process.platform === 'win32' ? 'bitcoin-cli.exe' : 'bitcoin-cli';
}

function bitcoinCli(config, args) {
  const baseArgs = [
    '-chain=testnet4',
    `-rpcwallet=${config.wallet}`,
    ...args
  ];
  if (config.datadir) baseArgs.unshift(`-datadir=${config.datadir}`);
  return execFileSync(cliPath(config.bitcoinBin), baseArgs, { encoding: 'utf8' }).trim();
}

function loadProtectedRegistry(config) {
  return ProtectedUtxos.loadRegistry(config.protectedRegistry, { network: 'BTCTEST' });
}

function coreLockProtectedUtxos(config) {
  if (config.ignoreProtectedUtxos) return { ignored: true, locked: 0, protectedSeen: 0 };
  const registry = loadProtectedRegistry(config);
  const unspent = JSON.parse(bitcoinCli(config, ['listunspent', '0', '9999999']));
  const protectedSeen = ProtectedUtxos.protectedUtxosFromList(unspent, registry);
  if (!protectedSeen.length) {
    return {
      locked: 0,
      protectedSeen: 0,
      registry: portablePath(config.protectedRegistry)
    };
  }
  const lockTargets = protectedSeen.map((utxo) => ({ txid: utxo.txid, vout: utxo.vout }));
  const ok = JSON.parse(bitcoinCli(config, ['lockunspent', 'false', JSON.stringify(lockTargets)]));
  return {
    ok,
    locked: lockTargets.length,
    protectedSeen: protectedSeen.length,
    registry: portablePath(config.protectedRegistry),
    outpoints: lockTargets.map((item) => `${item.txid}:${item.vout}`)
  };
}

function selectFundingUtxo(config) {
  const unspent = JSON.parse(bitcoinCli(config, [
    'listunspent',
    '0',
    '9999999',
    JSON.stringify([config.adminAddress])
  ]));
  const registry = config.ignoreProtectedUtxos
    ? ProtectedUtxos.emptyRegistry('BTCTEST')
    : loadProtectedRegistry(config);
  const protectedSkipped = ProtectedUtxos.protectedUtxosFromList(unspent, registry);
  const candidates = unspent
    .filter((utxo) => !ProtectedUtxos.isProtected(registry, utxo.txid, utxo.vout))
    .filter((utxo) => utxo.spendable && utxo.solvable && utxo.safe !== false)
    .map((utxo) => ({ ...utxo, amountSats: btcToSats(utxo.amount) }))
    .filter((utxo) => utxo.amountSats > BigInt(config.feeSats + 546))
    .sort((a, b) => (a.amountSats > b.amountSats ? -1 : a.amountSats < b.amountSats ? 1 : 0));
  if (!candidates.length) {
    throw new Error(`no spendable admin-address UTXO above fee+dust threshold for ${config.adminAddress}`);
  }
  return {
    utxo: candidates[0],
    protectedSkipped: protectedSkipped.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      address: utxo.address,
      amountBtc: utxo.amount,
      label: utxo.label || ''
    })),
    registryPath: portablePath(config.protectedRegistry)
  };
}

async function buildAnchor(config) {
  const receiptPath = path.resolve(config.liveReceipt);
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`live tx34 receipt not found: ${receiptPath}`);
  }

  const receipt = readJson(receiptPath);
  const envelopeId = String(receipt.envelopeId || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(envelopeId)) {
    throw new Error(`live tx34 receipt does not contain a valid envelopeId: ${receiptPath}`);
  }

  const resolved = await ZkEnvelopeResolver.resolveEnvelopeFromParams({
    envelopeId,
    envelopeRef: `zkda:${envelopeId}`
  });
  if (!resolved.envelope) {
    const attempts = Array.isArray(resolved.attempts) && resolved.attempts.length
      ? ` Attempts: ${resolved.attempts.join(', ')}`
      : '';
    throw new Error(`could not resolve tx34 ZK DA envelope ${envelopeId}: ${resolved.error || 'not found'}.${attempts}`);
  }
  if (resolved.envelope.envelopeId !== envelopeId) {
    throw new Error(`DA envelope id mismatch: receipt=${envelopeId} envelope=${resolved.envelope.envelopeId}`);
  }

  const envelopeCheck = ZkConsensus.verifyZkConsensusEnvelope(resolved.envelope);
  if (!envelopeCheck.ok) {
    throw new Error(`tx34 envelope failed consensus verification: ${envelopeCheck.reason || JSON.stringify(envelopeCheck)}`);
  }

  const verifierResult = await ZkWasmVerifier.verifyEnvelope(resolved.envelope);
  if (!verifierResult.ok) {
    throw new Error(`tx34 envelope failed pinned Rust/WASM verification: ${verifierResult.reason || JSON.stringify(verifierResult)}`);
  }

  const compactPayload = String(receipt.compactPayload || '').startsWith('z2|')
    ? receipt.compactPayload
    : Encode.encodeZkBatchMovement({ zkEnvelope: resolved.envelope, minimalAnchor: true });
  const payload = ensureTlPayload(34, compactPayload);
  const payloadBytes = Buffer.byteLength(payload, 'utf8');
  if (payloadBytes > OP_RETURN_LIMIT) {
    throw new Error(`tx34 anchor payload is ${payloadBytes} bytes, above ${OP_RETURN_LIMIT}`);
  }

  return {
    envelopeId,
    envelopeSource: portablePath(resolved.source),
    verifierWasmHash: resolved.envelope.envelopeCore.publicInputs.verifierWasmHash,
    proofType: resolved.envelope.envelopeCore.proofType,
    compactPayload,
    compactPayloadBytes: Buffer.byteLength(compactPayload, 'utf8'),
    payload,
    payloadBytes,
    payloadHex: asciiHex(payload),
    envelopeSha256: sha256Hex(JSON.stringify(resolved.envelope)),
    verifierResult
  };
}

function broadcastWithWalletCoinSelection(config, anchor) {
  const protectedLock = coreLockProtectedUtxos(config);
  const outputs = JSON.stringify([{ data: anchor.payloadHex }]);
  const raw = bitcoinCli(config, ['createrawtransaction', '[]', outputs]);
  const options = JSON.stringify({
    fee_rate: 1,
    changeAddress: config.adminAddress,
    include_unsafe: true
  });
  const funded = JSON.parse(bitcoinCli(config, ['fundrawtransaction', raw, options]));
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', funded.hex]));
  if (!signed.complete) throw new Error('wallet did not fully sign tx34 ZK anchor');
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  return {
    txid,
    feeBtc: funded.fee,
    protectedLock,
    explorer: `https://mempool.space/testnet4/tx/${txid}`
  };
}

function broadcastPayload(config, anchor) {
  if (config.allowWalletCoinSelection) return broadcastWithWalletCoinSelection(config, anchor);

  const selection = selectFundingUtxo(config);
  const utxo = selection.utxo;
  const changeSats = utxo.amountSats - BigInt(config.feeSats);
  if (changeSats <= 546n) throw new Error('selected admin-address UTXO would leave dust change');
  const inputs = JSON.stringify([{
    txid: utxo.txid,
    vout: utxo.vout,
    sequence: 4294967293
  }]);
  const outputs = JSON.stringify([
    { data: anchor.payloadHex },
    { [config.adminAddress]: satsToBtcString(changeSats) }
  ]);
  const raw = bitcoinCli(config, ['createrawtransaction', inputs, outputs]);
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', raw]));
  if (!signed.complete) throw new Error('wallet did not fully sign tx34 ZK anchor');
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  return {
    txid,
    feeBtc: Number(satsToBtcString(config.feeSats)),
    fundingInput: {
      txid: utxo.txid,
      vout: utxo.vout,
      address: utxo.address,
      amountBtc: utxo.amount
    },
    protectedUtxoPolicy: {
      registry: selection.registryPath,
      ignored: config.ignoreProtectedUtxos,
      skipped: selection.protectedSkipped
    },
    changeAddress: config.adminAddress,
    changeBtc: Number(satsToBtcString(changeSats)),
    explorer: `https://mempool.space/testnet4/tx/${txid}`
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const anchor = await buildAnchor(config);
  const result = {
    kind: 'tradelayer_btctest_tx34_zk_anchor',
    network: 'BTCTEST',
    bitcoinNetwork: 'testnet4',
    txType: 34,
    adminAddress: config.adminAddress,
    wallet: config.wallet,
    dryRun: config.dryRun,
    feeSats: config.feeSats,
    coinSelection: config.allowWalletCoinSelection ? 'bitcoin-core-wallet' : 'admin-address-only',
    protectedUtxoRegistry: portablePath(config.protectedRegistry),
    protectedUtxoPolicy: config.ignoreProtectedUtxos ? 'ignored-by-operator-flag' : 'enforced',
    createdAt: new Date().toISOString(),
    anchor
  };

  if (!config.dryRun) {
    result.broadcast = broadcastPayload(config, anchor);
  }

  fs.mkdirSync(path.dirname(config.artifact), { recursive: true });
  fs.writeFileSync(config.artifact, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    artifact: path.resolve(config.artifact),
    dryRun: config.dryRun,
    envelopeId: anchor.envelopeId,
    payload: anchor.payload,
    payloadBytes: anchor.payloadBytes,
    txid: result.broadcast && result.broadcast.txid,
    explorer: result.broadcast && result.broadcast.explorer
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  ensureTlPayload,
  buildAnchor,
  broadcastPayload
};
