/**
 * Matrix runner for tx30 BitVM Plan A live harness.
 *
 * Usage:
 *   node tests/tx30BitvmPlanAMatrix.js --verdict uphold
 *   node tests/tx30BitvmPlanAMatrix.js --verdict reject
 *   node tests/tx30BitvmPlanAMatrix.js --both
 */

const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { verdict: null, both: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--both') args.both = true;
    if (a === '--verdict') args.verdict = String(argv[i + 1] || '').toLowerCase();
  }
  return args;
}

function verdictList(args) {
  if (args.both) return ['uphold', 'reject'];
  if (args.verdict === 'uphold' || args.verdict === 'reject') return [args.verdict];
  return ['uphold', 'reject'];
}

function runVerdict(verdict) {
  const script = path.join(__dirname, 'tx30BitvmPlanALive.js');
  const env = { ...process.env, TL_BITVM_VERDICT: verdict };
  const started = Date.now();
  const res = spawnSync(process.execPath, [script], {
    env,
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  return {
    verdict,
    ok: res.status === 0,
    code: Number(res.status || 0),
    ms: Date.now() - started
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const verdicts = verdictList(args);
  const out = verdicts.map(runVerdict);
  const failed = out.filter((r) => !r.ok);

  console.log('\n[bitvm-plan-a-matrix] summary');
  for (const r of out) {
    console.log(`- ${r.verdict}: ${r.ok ? 'PASS' : 'FAIL'} (${r.ms}ms, code=${r.code})`);
  }
  if (failed.length > 0) process.exit(1);
}

main();
