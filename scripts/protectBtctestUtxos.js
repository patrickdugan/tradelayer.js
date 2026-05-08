#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ProtectedUtxos = require('../src/protectedUtxoRegistry');

const DEFAULT_WALLET = 'utxoref-testnet';

function parseArgs(argv) {
  const out = {
    bitcoinBin: process.env.BITCOIN_BIN || '',
    datadir: process.env.BTCTEST_DATADIR || '',
    wallet: process.env.BTCTEST_WALLET || DEFAULT_WALLET,
    registry: ProtectedUtxos.defaultRegistryPath(),
    txid: '',
    vout: null,
    address: '',
    amountBtc: null,
    label: '',
    protectionKind: 'protocol-ref',
    reason: '',
    commitmentId: '',
    lock: true,
    unlock: false,
    relock: false,
    list: false,
    dryRun: false
  };

  for (const arg of argv) {
    if (arg.startsWith('--bitcoin-bin=')) out.bitcoinBin = arg.slice('--bitcoin-bin='.length);
    else if (arg.startsWith('--datadir=')) out.datadir = arg.slice('--datadir='.length);
    else if (arg.startsWith('--wallet=')) out.wallet = arg.slice('--wallet='.length);
    else if (arg.startsWith('--registry=')) out.registry = arg.slice('--registry='.length);
    else if (arg.startsWith('--txid=')) out.txid = arg.slice('--txid='.length);
    else if (arg.startsWith('--vout=')) out.vout = Number(arg.slice('--vout='.length));
    else if (arg.startsWith('--address=')) out.address = arg.slice('--address='.length);
    else if (arg.startsWith('--amount-btc=')) out.amountBtc = Number(arg.slice('--amount-btc='.length));
    else if (arg.startsWith('--label=')) out.label = arg.slice('--label='.length);
    else if (arg.startsWith('--kind=')) out.protectionKind = arg.slice('--kind='.length);
    else if (arg.startsWith('--reason=')) out.reason = arg.slice('--reason='.length);
    else if (arg.startsWith('--commitment-id=')) out.commitmentId = arg.slice('--commitment-id='.length);
    else if (arg === '--no-lock') out.lock = false;
    else if (arg === '--unlock') out.unlock = true;
    else if (arg === '--relock') out.relock = true;
    else if (arg === '--list') out.list = true;
    else if (arg === '--dry-run') out.dryRun = true;
  }

  return out;
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

function readRegistry(config) {
  return ProtectedUtxos.loadRegistry(config.registry, { network: 'BTCTEST' });
}

function findLabelMatches(config) {
  if (!config.label) return [];
  const all = JSON.parse(bitcoinCli(config, ['listunspent', '0', '9999999']));
  return all.filter((utxo) => String(utxo.label || '') === config.label);
}

function explicitEntry(config) {
  if (!config.txid && config.vout === null) return null;
  return {
    txid: config.txid,
    vout: config.vout,
    address: config.address,
    amountBtc: config.amountBtc,
    label: config.label,
    protectionKind: config.protectionKind,
    reason: config.reason,
    commitmentId: config.commitmentId
  };
}

function entriesToProtect(config) {
  const entries = [];
  const explicit = explicitEntry(config);
  if (explicit) entries.push(explicit);
  for (const utxo of findLabelMatches(config)) {
    entries.push({
      txid: utxo.txid,
      vout: utxo.vout,
      address: utxo.address,
      amountBtc: utxo.amount,
      label: utxo.label,
      protectionKind: config.protectionKind,
      reason: config.reason || `matched wallet label ${config.label}`,
      commitmentId: config.commitmentId
    });
  }
  return entries;
}

function lockOutpoints(config, outpoints) {
  if (!outpoints.length) return { ok: true, locked: 0 };
  if (config.dryRun) return { ok: true, dryRun: true, locked: outpoints.length };
  const ok = JSON.parse(bitcoinCli(config, ['lockunspent', 'false', JSON.stringify(outpoints)]));
  return { ok, locked: outpoints.length };
}

function unlockOutpoints(config, outpoints) {
  if (!outpoints.length) return { ok: true, unlocked: 0 };
  if (config.dryRun) return { ok: true, dryRun: true, unlocked: outpoints.length };
  const ok = JSON.parse(bitcoinCli(config, ['lockunspent', 'true', JSON.stringify(outpoints)]));
  return { ok, unlocked: outpoints.length };
}

function writeIfChanged(config, registry) {
  if (config.dryRun) return registry;
  return ProtectedUtxos.writeRegistry(registry, config.registry);
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  let registry = readRegistry(config);
  const protectedBefore = ProtectedUtxos.activeEntries(registry).length;
  let changed = false;
  let lockResult = null;
  let unlockResult = null;

  if (config.unlock) {
    const entry = explicitEntry(config);
    if (!entry) throw new Error('--unlock requires --txid and --vout');
    const outpoint = [{ txid: ProtectedUtxos.normalizeTxid(entry.txid), vout: ProtectedUtxos.normalizeVout(entry.vout) }];
    registry = ProtectedUtxos.unmarkProtected(registry, entry);
    unlockResult = unlockOutpoints(config, outpoint);
    registry = writeIfChanged(config, registry);
    changed = true;
  } else {
    const entries = entriesToProtect(config);
    for (const entry of entries) {
      registry = ProtectedUtxos.markProtected(registry, entry);
      changed = true;
    }
    if (changed) registry = writeIfChanged(config, registry);
  }

  const lockTargets = config.relock || (config.lock && changed)
    ? ProtectedUtxos.lockRequests(registry)
    : [];
  if (!config.unlock && lockTargets.length) {
    lockResult = lockOutpoints(config, lockTargets);
    if (!config.dryRun && lockResult.ok) {
      registry = ProtectedUtxos.noteBitcoinCoreLocks(registry, lockTargets);
      registry = ProtectedUtxos.writeRegistry(registry, config.registry);
    }
  }

  let walletLocks = [];
  if (config.list || lockResult || unlockResult) {
    try {
      walletLocks = JSON.parse(bitcoinCli(config, ['listlockunspent']));
    } catch (err) {
      walletLocks = [{ error: err.message }];
    }
  }

  const result = {
    ok: true,
    dryRun: config.dryRun,
    registryPath: path.resolve(config.registry),
    protectedBefore,
    protectedAfter: ProtectedUtxos.activeEntries(registry).length,
    changed,
    lockResult,
    unlockResult,
    walletLocks,
    entries: ProtectedUtxos.activeEntries(registry)
  };

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  entriesToProtect,
  lockOutpoints,
  unlockOutpoints
};
