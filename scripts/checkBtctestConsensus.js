#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');

const DEFAULT_WALLET = 'utxoref-testnet';
const DEFAULT_ARTIFACT = path.join('artifacts', 'btctest-cross-domain-demo-latest.json');
const DEFAULT_REPORT = path.join('artifacts', 'btctest-consensus-check-latest.json');
const DEFAULT_ADMIN = 'tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu';

function parseArgs(argv) {
  const out = {
    datadir: process.env.BTCTEST_DATADIR || '',
    cookieFile: process.env.RPC_COOKIE_FILE || '',
    wallet: process.env.BTCTEST_WALLET || process.env.RPC_WALLET || DEFAULT_WALLET,
    dbRoot: process.env.TL_NEDB_ROOT || 'nedb-sandbox',
    artifact: process.env.TL_BTCTEST_CROSS_DOMAIN_ARTIFACT || DEFAULT_ARTIFACT,
    report: process.env.TL_BTCTEST_CONSENSUS_REPORT || DEFAULT_REPORT,
    rpcHost: process.env.RPC_HOST || '127.0.0.1',
    rpcPort: process.env.RPC_PORT || '48332',
    activationBlock: Number(process.env.TL_ACTIVATION_BLOCK || 1),
    fetchMissing: process.env.TL_FETCH_MISSING_RAW !== '0'
  };

  for (const arg of argv) {
    if (arg.startsWith('--datadir=')) out.datadir = arg.slice('--datadir='.length);
    else if (arg.startsWith('--cookie-file=')) out.cookieFile = arg.slice('--cookie-file='.length);
    else if (arg.startsWith('--wallet=')) out.wallet = arg.slice('--wallet='.length);
    else if (arg.startsWith('--db-root=')) out.dbRoot = arg.slice('--db-root='.length);
    else if (arg.startsWith('--artifact=')) out.artifact = arg.slice('--artifact='.length);
    else if (arg.startsWith('--report=')) out.report = arg.slice('--report='.length);
    else if (arg.startsWith('--rpc-host=')) out.rpcHost = arg.slice('--rpc-host='.length);
    else if (arg.startsWith('--rpc-port=')) out.rpcPort = arg.slice('--rpc-port='.length);
    else if (arg.startsWith('--activation-block=')) out.activationBlock = Number(arg.slice('--activation-block='.length));
    else if (arg === '--no-fetch-missing') out.fetchMissing = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }

  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/checkBtctestConsensus.js --datadir=<bitcoin-testnet-datadir>

Checks:
  - TradeLayer RPC bootstrap reaches Bitcoin Core testnet4
  - NeDB resolves to the BTC test profile
  - BTCTEST activation registry covers the demo tx types
  - Cross-domain proof txids decode through the configured node
  - TradeLayer state/code consensus hashes are produced

Options:
  --cookie-file=<path>      Bitcoin Core .cookie file. Defaults to <datadir>/testnet4/.cookie.
  --wallet=<name>           Wallet for wallet-scoped tx lookup. Defaults to ${DEFAULT_WALLET}.
  --db-root=<path>          NeDB root. Defaults to nedb-sandbox.
  --artifact=<path>         Cross-domain artifact. Defaults to ${DEFAULT_ARTIFACT}.
  --report=<path>           Output report. Defaults to ${DEFAULT_REPORT}.
  --no-fetch-missing        Do not fetch missing raw tx hex from mempool.space testnet4.
`);
}

function resolveRepoPath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function portablePath(value) {
  if (!value) return value;
  const rel = path.relative(process.cwd(), value);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : value;
}

function configureEnv(args) {
  const cookieFile = args.cookieFile || (args.datadir ? path.join(args.datadir, 'testnet4', '.cookie') : '');
  process.env.CHAIN = 'BTCTEST';
  process.env.AUTODETECT = '0';
  process.env.RPC_HOST = args.rpcHost;
  process.env.RPC_PORT = String(args.rpcPort);
  process.env.RPC_WALLET = args.wallet;
  process.env.TL_NEDB_ROOT = args.dbRoot;
  process.env.TL_ADMIN_ADDRESS = process.env.TL_ADMIN_ADDRESS || DEFAULT_ADMIN;
  if (cookieFile) process.env.RPC_COOKIE_FILE = cookieFile;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned ${res.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        resolve(body);
      });
    }).on('error', reject);
  });
}

function parseOpReturnPush(scriptHex) {
  if (!scriptHex || !scriptHex.startsWith('6a')) return null;
  let offset = 2;
  const opcode = parseInt(scriptHex.slice(offset, offset + 2), 16);
  offset += 2;
  let length;

  if (opcode <= 75) {
    length = opcode;
  } else if (opcode === 76) {
    length = parseInt(scriptHex.slice(offset, offset + 2), 16);
    offset += 2;
  } else if (opcode === 77) {
    const lo = parseInt(scriptHex.slice(offset, offset + 2), 16);
    const hi = parseInt(scriptHex.slice(offset + 2, offset + 4), 16);
    length = lo + (hi << 8);
    offset += 4;
  } else {
    return null;
  }

  return scriptHex.slice(offset, offset + length * 2);
}

async function walletGetTransaction(client, txid) {
  try {
    return await client.rpcCall('gettransaction', [txid, true], true);
  } catch (_err) {
    return null;
  }
}

async function getTxHex(client, step, fetchMissing) {
  try {
    const hex = await client.getRawTransaction(step.txid, false);
    return { hex, source: 'node-rawtransaction' };
  } catch (_err) {}

  const walletTx = await walletGetTransaction(client, step.txid);
  if (walletTx && walletTx.hex) {
    return { hex: walletTx.hex, source: 'wallet-transaction' };
  }

  if (!fetchMissing) {
    throw new Error(`tx ${step.txid} not available from node or wallet`);
  }

  const hex = (await httpsGet(`https://mempool.space/testnet4/api/tx/${step.txid}/hex`)).trim();
  if (!/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`invalid raw hex fetched for ${step.txid}`);
  }

  try {
    await client.sendrawtransaction(hex);
    return { hex, source: 'public-raw-rebroadcast' };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (
      message.includes('Transaction already in block chain') ||
      message.includes('txn-already-in-mempool') ||
      message.includes('already known') ||
      message.includes('Missing inputs') ||
      message.includes('bad-txns-inputs-missingorspent')
    ) {
      return { hex, source: `public-raw-decode-only:${message}` };
    }
    throw err;
  }
}

async function decodeProofSteps(client, artifact, fetchMissing) {
  const results = [];
  for (const step of artifact.steps) {
    const { hex, source } = await getTxHex(client, step, fetchMissing);
    const decoded = await client.decoderawtransaction(hex);
    const nulldata = decoded.vout.find((output) => {
      const type = output.scriptPubKey && output.scriptPubKey.type;
      return type === 'nulldata' || type === 'op_return';
    });
    const payloadHex = parseOpReturnPush(nulldata && nulldata.scriptPubKey && nulldata.scriptPubKey.hex);
    const payload = payloadHex ? Buffer.from(payloadHex, 'hex').toString('utf8') : '';
    const tradeLayerType = payload.startsWith('tl') ? parseInt(payload[2], 36) : null;
    const expectedType = step.txType === null || step.txType === undefined ? null : Number(step.txType);
    const typeOk = expectedType === null ? tradeLayerType === null : tradeLayerType === expectedType;
    const payloadOk = step.payloadHex ? payloadHex === step.payloadHex : Boolean(payloadHex);
    let referenceOk = true;
    let referenceOutput = null;
    if (expectedType === 33 && (step.label === 'pledge-tlusd-hybrid-colored' || step.label === 'make-tap-asset-tlusd')) {
      const body = payload.slice(3);
      const parts = body.split(',');
      const refVout = Number(parts[12] || parts[5]);
      referenceOutput = decoded.vout.find((output) => Number(output.n) === refVout) || null;
      const scriptType = String(referenceOutput?.scriptPubKey?.type || '').toLowerCase();
      const address = String(referenceOutput?.scriptPubKey?.address || '').toLowerCase();
      referenceOk = Boolean(referenceOutput) && (scriptType === 'witness_v1_taproot' || address.startsWith('tb1p') || address.startsWith('bc1p'));
    }

    results.push({
      label: step.label,
      txid: step.txid,
      txType: expectedType,
      source,
      voutCount: decoded.vout.length,
      payload,
      payloadOk,
      typeOk,
      referenceOk,
      referenceOutput: referenceOutput
        ? {
            vout: referenceOutput.n,
            value: referenceOutput.value,
            type: referenceOutput.scriptPubKey?.type,
            address: referenceOutput.scriptPubKey?.address
          }
        : null,
      ok: Boolean(payloadHex) && payloadOk && typeOk && referenceOk
    });
  }
  return results;
}

async function upsertBtctestActivations(db, activationBlock) {
  const {
    buildActivationManifest,
    registryFromManifest
  } = require('./testnetActivationProfile');

  const manifest = buildActivationManifest({
    network: 'BTCTEST',
    activationBlock
  });
  const activationsDB = await db.getDatabase('activations');
  const current = await activationsDB.findOneAsync({ _id: 'activationsList' });
  let existing = {};
  if (current && current.value) {
    try {
      existing = JSON.parse(current.value);
    } catch (_err) {}
  }

  const registry = {
    ...existing,
    ...registryFromManifest(manifest)
  };
  await activationsDB.updateAsync(
    { _id: 'activationsList' },
    { $set: { value: JSON.stringify(registry) } },
    { upsert: true }
  );

  return { manifest, registry };
}

function summarizeChecks(report) {
  return {
    ok: report.ok,
    chain: report.node.chain,
    blocks: report.node.blocks,
    dbPath: report.database.path,
    activationCount: report.activations.activeCount,
    proofTxs: report.proof.okCount,
    consensusHash: report.consensus.stateHash,
    codeHash: report.consensus.codeHash,
    report: report.reportPath
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  configureEnv(args);

  const ClientWrapper = require('../src/client');
  const db = require('../src/db');
  const Consensus = require('../src/consensus');

  const artifactPath = resolveRepoPath(args.artifact);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const client = await ClientWrapper.getInstance();
  const blockchain = await client.getBlockchainInfo();
  const network = await client.getNetworkInfo();
  const walletInfo = await client.getwalletinfo();
  await db.init('BTC');

  const { manifest, registry } = await upsertBtctestActivations(db, args.activationBlock);
  const neededTxTypes = [...new Set(artifact.steps.map((step) => step.txType).filter((value) => value !== null && value !== undefined).map(Number))];
  const activationChecks = neededTxTypes.map((txType) => ({
    txType,
    active: Boolean(registry[txType] && registry[txType].active),
    activationBlock: registry[txType] && registry[txType].activationBlock
  }));

  const proofChecks = await decodeProofSteps(client, artifact, args.fetchMissing);
  const stateHash = await Consensus.stateConsensusHash();
  const codeHash = await Consensus.hashFiles();

  const reportPath = resolveRepoPath(args.report);
  const report = {
    kind: 'btctest_consensus_check',
    generatedAt: new Date().toISOString(),
    node: {
      chain: blockchain.chain,
      blocks: blockchain.blocks,
      headers: blockchain.headers,
      initialblockdownload: blockchain.initialblockdownload,
      verificationprogress: blockchain.verificationprogress,
      subversion: network.subversion,
      wallet: walletInfo.walletname
    },
    database: {
      root: args.dbRoot,
      path: portablePath(db.path)
    },
    activations: {
      network: manifest.network,
      activeCount: activationChecks.filter((item) => item.active).length,
      neededTxTypes,
      checks: activationChecks
    },
    proof: {
      artifact: portablePath(artifactPath),
      txCount: proofChecks.length,
      okCount: proofChecks.filter((item) => item.ok).length,
      checks: proofChecks
    },
    consensus: {
      stateHash,
      codeHash
    },
    reportPath: portablePath(reportPath),
    ok: blockchain.chain === 'testnet4' &&
      blockchain.initialblockdownload === false &&
      activationChecks.every((item) => item.active) &&
      proofChecks.every((item) => item.ok) &&
      /^[0-9a-f]{64}$/.test(stateHash || '') &&
      /^[0-9a-f]{64}$/.test(codeHash || '')
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(summarizeChecks(report), null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  configureEnv,
  parseOpReturnPush,
  decodeProofSteps
};
