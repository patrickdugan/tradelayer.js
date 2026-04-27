#!/usr/bin/env node

const {
  buildActivationManifest,
  registryFromManifest
} = require('./testnetActivationProfile');

function parseArgs(argv) {
  const out = {
    mode: 'print',
    network: process.env.TL_ACTIVATION_NETWORK || process.env.CHAIN || 'BTCTEST',
    activationBlock: Number(process.env.TL_ACTIVATION_BLOCK || 1),
    dbRoot: process.env.TL_ACTIVATION_DB_ROOT || 'nedb-sandbox',
    admin: process.env.TL_ADMIN_ADDRESS || ''
  };

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--network=')) out.network = arg.slice('--network='.length);
    else if (arg.startsWith('--activation-block=')) out.activationBlock = Number(arg.slice('--activation-block='.length));
    else if (arg.startsWith('--db-root=')) out.dbRoot = arg.slice('--db-root='.length);
    else if (arg.startsWith('--admin=')) out.admin = arg.slice('--admin='.length);
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/setupTestnetActivationSet.js --mode=print
  node scripts/setupTestnetActivationSet.js --mode=local-db --db-root=nedb-sandbox
  node scripts/setupTestnetActivationSet.js --mode=broadcast --admin=<testnet-admin-address>

Modes:
  print      Emit the activation manifest only.
  local-db   Write the activation registry to a local NeDB root. Defaults to nedb-sandbox.
  broadcast  Send activation transactions from the admin wallet using TxUtils.activationTransaction.

Live listener note:
  Use --db-root=nedb-data only when you intentionally want the running TradeLayer listener to read this registry.
`);
}

function dbChainFromNetwork(network) {
  const normalized = String(network || '').toUpperCase();
  if (normalized === 'BTC') return 'BTC';
  if (normalized === 'LTC') return 'LTC';
  if (normalized === 'LTCTEST') return 'LTC';
  if (normalized === 'BTCTEST' || normalized === 'BTC_TESTNET' || normalized === 'BTC_TESTNET4') return 'BTC';
  if (normalized === 'DOGETEST') return 'DOGE';
  return normalized || 'LTC';
}

async function writeLocalDb(manifest, dbRoot) {
  process.env.TL_SKIP_RPC_BOOT = '1';
  process.env.TL_FORCE_TEST = '1';
  const dbChain = dbChainFromNetwork(manifest.network);
  process.env.CHAIN = dbChain;
  process.env.TL_NEDB_ROOT = dbRoot;

  const db = require('../src/db.js');
  await db.init(dbChain);
  const activationsDB = await db.getDatabase('activations');
  const registry = await buildMergedRegistry(activationsDB, manifest);
  await activationsDB.updateAsync(
    { _id: 'activationsList' },
    { $set: { value: JSON.stringify(registry) } },
    { upsert: true }
  );

  return {
    mode: 'local-db',
    dbRoot,
    dbChain,
    resolvedDbPath: db.path,
    activeCount: manifest.txTypes.length,
    txTypes: manifest.txTypes
  };
}

async function buildMergedRegistry(activationsDB, manifest) {
  let existing = {};
  const current = await activationsDB.findOneAsync({ _id: 'activationsList' });
  if (current && current.value) {
    try {
      existing = JSON.parse(current.value);
    } catch (err) {
      existing = {};
    }
  }

  const overlay = registryFromManifest(manifest);
  const merged = { ...existing };
  for (const [txType, activation] of Object.entries(overlay)) {
    if (manifest.txTypes.includes(Number(txType))) {
      merged[txType] = {
        ...(existing[txType] || {}),
        ...activation
      };
    } else if (!merged[txType]) {
      merged[txType] = activation;
    }
  }
  return merged;
}

async function broadcastActivations(manifest, admin) {
  if (!admin) {
    throw new Error('broadcast mode requires --admin or TL_ADMIN_ADDRESS');
  }

  const TxUtils = require('../src/txUtils');
  const sent = [];
  for (const txType of manifest.txTypes) {
    const txid = await TxUtils.activationTransaction(admin, txType);
    sent.push({ txType, txid });
  }
  return {
    mode: 'broadcast',
    admin,
    sent
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!Number.isFinite(args.activationBlock) || args.activationBlock < 0) {
    throw new Error(`invalid activation block: ${args.activationBlock}`);
  }

  const manifest = buildActivationManifest({
    network: args.network,
    activationBlock: args.activationBlock
  });

  if (args.mode === 'print') {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (args.mode === 'local-db') {
    const result = await writeLocalDb(manifest, args.dbRoot);
    console.log(JSON.stringify({ ok: true, manifest, result }, null, 2));
    return;
  }

  if (args.mode === 'broadcast') {
    const result = await broadcastActivations(manifest, args.admin || manifest.adminAddress);
    console.log(JSON.stringify({ ok: true, manifest, result }, null, 2));
    return;
  }

  throw new Error(`unknown mode ${args.mode}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  dbChainFromNetwork,
  buildMergedRegistry,
  writeLocalDb,
  broadcastActivations
};
