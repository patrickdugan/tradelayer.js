const { spawnSync } = require('child_process');
const path = require('path');
const TxUtils = require('../src/txUtils');

function argsFromCli(argv) {
  const out = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const idx = body.indexOf('=');
    if (idx === -1) out[body] = true;
    else out[body.slice(0, idx)] = body.slice(idx + 1);
  }
  return out;
}

function envFromCli(cli, name, target = name, fallback) {
  if (cli[name] !== undefined) return String(cli[name]);
  if (process.env[target] !== undefined && process.env[target] !== '') return String(process.env[target]);
  return fallback;
}

function spawnScript(scriptRelPath, extraEnv) {
  const run = spawnSync('node', [path.join('tests', scriptRelPath)], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    throw new Error(`${scriptRelPath} exited with code ${run.status}`);
  }
  return run.stdout || '';
}

function parseSummary(stdout, prefix) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  const summaryLine = [...lines].reverse().find((line) => line.startsWith(prefix));
  if (!summaryLine) return null;
  const raw = summaryLine.slice(prefix.length);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function routerEnvFromCli(cli) {
  return {
    CHAIN: envFromCli(cli, 'chain', 'CHAIN', 'LTCTEST'),
    RPC_HOST: envFromCli(cli, 'rpcHost', 'RPC_HOST', '127.0.0.1'),
    RPC_PORT: envFromCli(cli, 'rpcPort', 'RPC_PORT', '19332'),
    RPC_USER: envFromCli(cli, 'rpcUser', 'RPC_USER', 'user'),
    RPC_PASS: envFromCli(cli, 'rpcPass', 'RPC_PASS', 'pass'),
    RPC_WALLET: envFromCli(cli, 'rpcWallet', 'RPC_WALLET', 'tl-wallet'),
    WALLET_NAME: envFromCli(cli, 'walletName', 'WALLET_NAME', 'tl-wallet'),
    TL_ADMIN_ADDRESS: envFromCli(cli, 'admin', 'TL_ADMIN_ADDRESS', ''),
    TL_ORACLE_ADMIN_ADDRESS: envFromCli(cli, 'oracleAdmin', 'TL_ORACLE_ADMIN_ADDRESS', ''),
    TL_ALICE_ADDRESS: envFromCli(cli, 'alice', 'TL_ALICE_ADDRESS', ''),
    TL_BOB_ADDRESS: envFromCli(cli, 'bob', 'TL_BOB_ADDRESS', ''),
    TL_CHARLIE_ADDRESS: envFromCli(cli, 'charlie', 'TL_CHARLIE_ADDRESS', ''),
    TL_DEPOSIT_ALICE: envFromCli(cli, 'depositAlice', 'TL_DEPOSIT_ALICE', ''),
    TL_DEPOSIT_BOB: envFromCli(cli, 'depositBob', 'TL_DEPOSIT_BOB', ''),
    TL_DEPOSIT_CHARLIE: envFromCli(cli, 'depositCharlie', 'TL_DEPOSIT_CHARLIE', ''),
    TL_ENTRY_PRICE: envFromCli(cli, 'entryPrice', 'TL_ENTRY_PRICE', ''),
    TL_EXIT_PRICE: envFromCli(cli, 'exitPrice', 'TL_EXIT_PRICE', ''),
    TL_LEVERAGE: envFromCli(cli, 'leverage', 'TL_LEVERAGE', ''),
    TL_EXPIRY_BLOCKS: envFromCli(cli, 'expiryBlocks', 'TL_EXPIRY_BLOCKS', '4'),
    TL_ADAPTER_PATH_COUNT: envFromCli(cli, 'adapterPathCount', 'TL_ADAPTER_PATH_COUNT', ''),
    TL_REALIZED_LOSS_BPS: envFromCli(cli, 'realizedLossBps', 'TL_REALIZED_LOSS_BPS', ''),
    TL_SHORT_TICKER: envFromCli(cli, 'shortTicker', 'TL_SHORT_TICKER', ''),
    TL_STATE_ORACLE_TICKER: envFromCli(cli, 'stateOracleTicker', 'TL_STATE_ORACLE_TICKER', ''),
    TL_PRICE_ORACLE_TICKER: envFromCli(cli, 'priceOracleTicker', 'TL_PRICE_ORACLE_TICKER', ''),
    TL_TEMPLATE_ID: envFromCli(cli, 'templateId', 'TL_TEMPLATE_ID', ''),
    TL_SHORT_CONTRACT_REF: envFromCli(cli, 'contractRef', 'TL_SHORT_CONTRACT_REF', ''),
    TL_BITVM_CACHE_DELAY_BLOCKS: envFromCli(cli, 'cacheDelayBlocks', 'TL_BITVM_CACHE_DELAY_BLOCKS', '0'),
    TL_APPLY_IMMEDIATE: envFromCli(cli, 'applyImmediate', 'TL_APPLY_IMMEDIATE', 'true'),
    TL_DRY_RUN: envFromCli(cli, 'dryRun', 'TL_DRY_RUN', 'false')
  };
}

function dailyEnvFromCli(cli, routerSummary, walletEnv = {}) {
  const addresses = envFromCli(cli, 'addresses', 'TL_STATE_ADDRESSES', [
    envFromCli(cli, 'alice', 'TL_ALICE_ADDRESS', walletEnv.TL_ALICE_ADDRESS || ''),
    envFromCli(cli, 'bob', 'TL_BOB_ADDRESS', walletEnv.TL_BOB_ADDRESS || ''),
    envFromCli(cli, 'charlie', 'TL_CHARLIE_ADDRESS', walletEnv.TL_CHARLIE_ADDRESS || ''),
    envFromCli(cli, 'admin', 'TL_ADMIN_ADDRESS', walletEnv.TL_ADMIN_ADDRESS || ''),
    envFromCli(cli, 'oracleAdmin', 'TL_ORACLE_ADMIN_ADDRESS', walletEnv.TL_ORACLE_ADMIN_ADDRESS || '')
  ].filter(Boolean).join(','));

  return {
    TL_ORACLE_ID: envFromCli(cli, 'oracleId', 'TL_ORACLE_ID', String(routerSummary.stateOracleId || '')),
    TL_ORACLE_ADMIN_ADDRESS: envFromCli(cli, 'oracleAdmin', 'TL_ORACLE_ADMIN_ADDRESS', walletEnv.TL_ORACLE_ADMIN_ADDRESS || ''),
    TL_DLC_CONTRACT_ID: envFromCli(cli, 'dlcRef', 'TL_DLC_CONTRACT_ID', String(routerSummary.contractId || '')),
    TL_STATE_PROPERTY_ID: envFromCli(cli, 'propertyId', 'TL_STATE_PROPERTY_ID', String(routerSummary.shortPropertyId || '')),
    TL_STATE_ADDRESSES: addresses,
    TL_STATE_BUCKET_SIZE: envFromCli(cli, 'bucketSize', 'TL_STATE_BUCKET_SIZE', '1'),
    TL_STATE_FROM_BLOCK: envFromCli(cli, 'fromBlock', 'TL_STATE_FROM_BLOCK', ''),
    TL_STATE_TO_BLOCK: envFromCli(cli, 'toBlock', 'TL_STATE_TO_BLOCK', ''),
    TL_STATE_INCLUDE_ZERO: envFromCli(cli, 'includeZero', 'TL_STATE_INCLUDE_ZERO', 'false'),
    TL_STATE_OMIT_NOOP: envFromCli(cli, 'omitNoOp', 'TL_STATE_OMIT_NOOP', 'true'),
    TL_STATE_INCLUDE_OPS: envFromCli(cli, 'includeOps', 'TL_STATE_INCLUDE_OPS', 'issue,redeem,rpnl'),
    TL_STATE_KIND: envFromCli(cli, 'stateKind', 'TL_STATE_KIND', 'daily'),
    TL_STATE_ROLL_HEIGHT: envFromCli(cli, 'rollHeight', 'TL_STATE_ROLL_HEIGHT', ''),
    TL_DRY_RUN: envFromCli(cli, 'dailyDryRun', 'TL_DRY_RUN', 'false'),
    TL_APPLY_IMMEDIATE: envFromCli(cli, 'dailyApplyImmediate', 'TL_APPLY_IMMEDIATE', 'true')
  };
}

async function pickWalletAddresses() {
  await TxUtils.init();
  const loadedWallets = await TxUtils.client.rpcCall('listwallets', [], false).catch(() => []);
  const preferredWallet = Array.isArray(loadedWallets) && loadedWallets.length > 0
    ? (loadedWallets.includes('tl-wallet') ? 'tl-wallet' : String(loadedWallets[0]))
    : '';
  if (preferredWallet && !process.env.RPC_WALLET) {
    process.env.RPC_WALLET = preferredWallet;
  }
  const utxos = await TxUtils.client.listUnspent(0, 9999999);
  const grouped = new Map();
  for (const utxo of utxos || []) {
    if (!utxo?.address || Number(utxo.amount || 0) <= 0) continue;
    const current = grouped.get(utxo.address) || { address: utxo.address, amount: 0, count: 0 };
    current.amount += Number(utxo.amount || 0);
    current.count += 1;
    grouped.set(utxo.address, current);
  }
  return Array.from(grouped.values())
    .sort((a, b) => b.amount - a.amount)
    .map((row) => row.address);
}

async function inferWalletEnv(cli) {
  const auto = String(envFromCli(cli, 'autoWallet', 'TL_AUTO_WALLET', 'true')).toLowerCase() !== 'false';
  if (!auto) return {};

  const addresses = await pickWalletAddresses();
  const [admin = '', oracleAdmin = '', alice = '', bob = '', charlie = ''] = addresses;
  return {
    TL_ADMIN_ADDRESS: envFromCli(cli, 'admin', 'TL_ADMIN_ADDRESS', admin),
    TL_ORACLE_ADMIN_ADDRESS: envFromCli(cli, 'oracleAdmin', 'TL_ORACLE_ADMIN_ADDRESS', oracleAdmin || admin),
    TL_ALICE_ADDRESS: envFromCli(cli, 'alice', 'TL_ALICE_ADDRESS', alice || admin),
    TL_BOB_ADDRESS: envFromCli(cli, 'bob', 'TL_BOB_ADDRESS', bob || alice || admin),
    TL_CHARLIE_ADDRESS: envFromCli(cli, 'charlie', 'TL_CHARLIE_ADDRESS', charlie || bob || alice || admin)
  };
}

async function main() {
  const cli = argsFromCli(process.argv.slice(2));
  const walletEnv = await inferWalletEnv(cli);
  const routerStdout = spawnScript('utxoBitvmShortEpochRouterLive.js', { ...routerEnvFromCli(cli), ...walletEnv });
  const routerSummary = parseSummary(routerStdout, '[utxo-bitvm-short-epoch-router-live] summary ');
  if (!routerSummary) {
    throw new Error('Unable to parse router summary');
  }

  const dailyStdout = spawnScript('dlcStateOracleRelayLive.js', { ...dailyEnvFromCli(cli, routerSummary, walletEnv), ...walletEnv });
  const dailySummary = parseSummary(dailyStdout, '[state-oracle-live] summary ');
  if (!dailySummary) {
    throw new Error('Unable to parse daily oracle summary');
  }

  console.log('[dlc-daily-short-epoch-bundle-live] router-summary ' + JSON.stringify(routerSummary));
  console.log('[dlc-daily-short-epoch-bundle-live] daily-summary ' + JSON.stringify(dailySummary));
  console.log('[dlc-daily-short-epoch-bundle-live] OK ' + JSON.stringify({
    shortPropertyId: routerSummary.shortPropertyId,
    contractId: routerSummary.contractId,
    payloadHash: dailySummary.payloadHash,
    blobRef: dailySummary.blobRef,
    kind: dailySummary.kind,
    windowStartBlock: dailySummary.windowStartBlock,
    windowEndBlock: dailySummary.windowEndBlock,
    rollHeight: dailySummary.rollHeight,
    snapshotBlock: dailySummary.snapshotBlock,
    rowCount: dailySummary.rowCount
  }));
}

main().catch((err) => {
  console.error('[dlc-daily-short-epoch-bundle-live] failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
