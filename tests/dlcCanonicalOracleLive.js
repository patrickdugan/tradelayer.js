const axios = require('axios');
const { spawnSync } = require('child_process');
const path = require('path');

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

async function post(url, data = {}) {
  const r = await axios.post(url, data, { timeout: 15000 });
  return r.data;
}

async function main() {
  const cli = argsFromCli(process.argv.slice(2));
  const baseUrl = cli.baseUrl || 'http://localhost:3000';
  const dryRun = !(cli.apply === '1' || cli.apply === true);

  const parsed = await post(`${baseUrl}/tl_getMaxParsedHeight`, {});
  if (!parsed) throw new Error('Listener is not initialized (max parsed height missing)');

  const oracles = await post(`${baseUrl}/tl_listOracles`, {});
  if (!Array.isArray(oracles) || oracles.length === 0) {
    throw new Error('No oracles available from listener');
  }
  const first = oracles[0];
  const oracleId = Number(cli.oracleId || first.id || String(first._id || '').split('-')[1] || 0);
  const oracleAddress = cli.oracleAddress || first.adminAddress || first?.name?.adminAddress;
  if (!oracleId || !oracleAddress) throw new Error('Unable to resolve oracleId/oracleAddress');

  const cmdArgs = [
    path.join('utils', 'canonicalStateOracle.js'),
    `--oracleId=${oracleId}`,
    `--oracleAddress=${oracleAddress}`,
    `--propertyId=${cli.propertyId || 5}`,
    `--dlcRef=${cli.dlcRef || 'ct-live'}`,
    `--settlementState=${cli.settlementState || 'SETTLED'}`,
    `--relayType=${cli.relayType || 1}`,
    `--settleAction=${cli.settleAction || 'pnl_sweep'}`,
    `--amount=${cli.amount || '0.00000001'}`,
    `--fromAddress=${cli.fromAddress || oracleAddress}`,
    `--toAddress=${cli.toAddress || oracleAddress}`,
    `--dryRun=${dryRun ? '1' : '0'}`
  ];

  if (cli.nextPropertyId) cmdArgs.push(`--nextPropertyId=${cli.nextPropertyId}`);
  if (cli.nextDlcRef) cmdArgs.push(`--nextDlcRef=${cli.nextDlcRef}`);
  if (cli.autoRoll) cmdArgs.push(`--autoRoll=${cli.autoRoll}`);
  if (cli.oraclePrivkeyHex) cmdArgs.push(`--oraclePrivkeyHex=${cli.oraclePrivkeyHex}`);
  if (cli.oraclePubkeyHex) cmdArgs.push(`--oraclePubkeyHex=${cli.oraclePubkeyHex}`);

  const run = spawnSync('node', cmdArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    encoding: 'utf8'
  });
  if (run.status !== 0) {
    throw new Error(`canonicalStateOracle exited with code ${run.status}`);
  }

  const after = await post(`${baseUrl}/tl_getMaxParsedHeight`, {});
  console.log('[dlc-canonical-live] OK', {
    listenerParsedBefore: parsed,
    listenerParsedAfter: after,
    dryRun
  });
}

main().catch((err) => {
  console.error('[dlc-canonical-live] FAIL', err.message);
  process.exit(1);
});

