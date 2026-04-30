const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');

const IS_BTC = String(process.env.CHAIN || '').toUpperCase().includes('BTC');
process.env.RPC_WALLET = process.env.RPC_WALLET || process.env.WALLET_NAME || (IS_BTC ? 'utxoref-testnet' : 'tl-wallet');

const TxUtils = require('../src/txUtils.js');
const TallyMap = require('../src/tally.js');
const { PnlRouteRegistry } = require('../src/pnlRouteRegistry.js');
const { createOracleSigner } = require('../tests/makeshiftOracle.js');

const COIN = 100000000;
const NETWORK = IS_BTC ? bitcoin.networks.testnet : {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'tltc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0x3a,
  wif: 0xef
};

const ARTIFACT_PREFIX = process.env.TL_ARTIFACT_PREFIX || (IS_BTC ? 'btctest' : 'ltc');
const SOURCE_ARTIFACT = process.env.TL_DLC_ARTIFACT || path.join(__dirname, '..', 'artifacts', `${ARTIFACT_PREFIX}-second-funder-dlc-perp-tlusd-latest.json`);
const OUT = process.env.TL_PNL_REVEAL_OUT || path.join(__dirname, '..', 'artifacts', `${ARTIFACT_PREFIX}-pnl-witness-reveal-latest.json`);
const BROADCAST = process.env.TL_BROADCAST !== '0';
const WITNESS_LIMIT = Number(process.env.TL_PNL_WITNESS_LIMIT || 9900);

function sats(coin) {
  return Math.round(Number(coin) * COIN);
}

function ltc(satoshis) {
  return Number((Number(satoshis) / COIN).toFixed(8));
}

function sha256Hex(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : stableStringify(value), 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function chunkBuffer(buffer, size = 520) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size));
  }
  return chunks;
}

function makeRevealScript(envelope) {
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
  const ops = [Buffer.from('TLPNLROUTE:1', 'utf8'), bitcoin.opcodes.OP_DROP];
  for (const chunk of chunkBuffer(payload)) {
    ops.push(chunk, bitcoin.opcodes.OP_DROP);
  }
  ops.push(bitcoin.opcodes.OP_TRUE);
  const script = bitcoin.script.compile(ops);
  if (script.length > WITNESS_LIMIT) {
    throw new Error(`PNL witness script ${script.length} bytes exceeds limit ${WITNESS_LIMIT}; use a merkle root plus paged reveals`);
  }
  return { script, payloadBytes: payload.length, scriptBytes: script.length };
}

function parsePnlEntries(artifact) {
  if (process.env.TL_PNL_VECTOR_JSON) {
    return JSON.parse(fs.readFileSync(process.env.TL_PNL_VECTOR_JSON, 'utf8'));
  }

  const tos = parseList(process.env.TL_PNL_TO_LIST);
  const froms = parseList(process.env.TL_PNL_FROM_LIST);
  const amounts = parseList(process.env.TL_PNL_AMOUNT_LIST).map(Number);
  if (tos.length) {
    return tos.map((toAddress, i) => ({
      fromAddress: froms[i] || process.env.TL_PNL_FROM || artifact.firstFunder,
      toAddress,
      tokenAmount: Number.isFinite(amounts[i]) && amounts[i] > 0 ? amounts[i] : Number(process.env.TL_PNL_SWEEP_AMOUNT || 0.0001)
    }));
  }

  return [{
    fromAddress: process.env.TL_PNL_FROM || artifact.firstFunder,
    toAddress: process.env.TL_PNL_TO || artifact.secondFunder,
    tokenAmount: Number(process.env.TL_PNL_SWEEP_AMOUNT || 0.0001)
  }];
}

async function largestUtxo(client, address) {
  const utxos = await client.listUnspent(0, 9999999, [address]);
  return (utxos || [])
    .filter((u) => Number(u.amount || 0) > 0 && u.spendable !== false)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
}

async function fundRevealCommit(client, sender, p2wshAddress, commitAmount) {
  const utxo = await largestUtxo(client, sender);
  if (!utxo) throw new Error(`No spendable UTXO for ${sender}`);

  const fee = Number(process.env.TL_REVEAL_COMMIT_FEE || 0.00005);
  const change = Number((Number(utxo.amount) - commitAmount - fee).toFixed(8));
  if (change <= 0) throw new Error(`UTXO ${utxo.txid}:${utxo.vout} too small`);

  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: utxo.txid, vout: utxo.vout }],
    [
      { [p2wshAddress]: commitAmount },
      { [sender]: change }
    ]
  ], false);
  const signed = await client.signrawtransactionwithwallet(raw);
  if (!signed.complete) throw new Error('wallet did not sign reveal commit');
  const decoded = await client.decoderawtransaction(signed.hex);
  const accept = await client.rpcCall('testmempoolaccept', [[signed.hex]], false);
  const txid = BROADCAST ? await client.sendrawtransaction(signed.hex) : decoded.txid;
  return { txid, hex: signed.hex, decoded, accept, fundingUtxo: utxo };
}

function buildRevealSpend(commitTxid, commitVout, commitSats, witnessScript, destination) {
  const feeSats = Number(process.env.TL_REVEAL_SPEND_FEE_SATS || 2000);
  const outSats = commitSats - feeSats;
  if (outSats <= 0) throw new Error('Reveal commit amount too small to spend');
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(commitTxid, 'hex').reverse(), commitVout, 0xffffffff);
  tx.addOutput(bitcoin.address.toOutputScript(destination, NETWORK), outSats);
  tx.setWitness(0, [witnessScript]);
  return { hex: tx.toHex(), feeSats, output: { address: destination, sats: outSats, amount: ltc(outSats) } };
}

async function main() {
  await TxUtils.init();
  const client = TxUtils.client;
  const artifact = JSON.parse(fs.readFileSync(SOURCE_ARTIFACT, 'utf8'));
  const block = await client.getBlockCount();
  const oracleAddress = process.env.TL_STATE_ORACLE_ADDRESS || artifact.firstFunder;
  const revealDestination = process.env.TL_REVEAL_DESTINATION || oracleAddress;
  const propertyId = Number(process.env.TL_PNL_PROPERTY_ID || artifact.procedural.propertyId);
  const entries = parsePnlEntries(artifact);
  const addresses = [...new Set(entries.flatMap((entry) => [entry.fromAddress, entry.toAddress]))];
  const balances = await Promise.all(addresses.map(async (address) => ({
    address,
    balance: await TallyMap.getTally(address, propertyId)
  })));

  const totalPositive = entries.reduce((sum, entry) => sum + Number(entry.tokenAmount || 0), 0);
  const payload = {
    protocol: 'tl-utxoref-pnl-router',
    version: 1,
    chain: process.env.TL_CHAIN_LABEL || (IS_BTC ? 'bitcoin-testnet4' : 'litecoin-testnet'),
    source: 'state-oracle-witness-reveal',
    block,
    generatedAt: new Date().toISOString(),
    dlcRef: process.env.TL_PNL_DLC_REF || artifact.procedural.contractId,
    propertyId,
    tokenPnl: entries,
    balances,
    utxoPayouts: entries.map((entry) => ({
      address: entry.toAddress,
      weight: Number(entry.tokenAmount || 0),
      tokenAmount: Number(entry.tokenAmount || 0)
    })),
    constraints: {
      dustSats: Number(process.env.TL_DLC_DUST_SATS || 546),
      note: 'Resolver must route the UTXO to every address in utxoPayouts, weighted by positive token PNL.'
    }
  };
  const payloadHash = sha256Hex(payload);
  const signer = createOracleSigner();
  const attestation = signer.signBundle({
    eventId: `${payload.dlcRef}-pnl-route-${crypto.randomBytes(4).toString('hex')}`,
    outcome: 'PNL_ROUTE',
    outcomeIndex: 0,
    stateHash: payloadHash,
    payloadHash,
    timestamp: Math.floor(Date.now() / 1000)
  });
  const envelope = {
    envelope: 'TLPNLROUTE',
    payload,
    payloadHash,
    attestation
  };

  const reveal = makeRevealScript(envelope);
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: reveal.script }, network: NETWORK });
  const commitAmount = Number(process.env.TL_REVEAL_COMMIT_AMOUNT || 0.0002);
  const commit = await fundRevealCommit(client, oracleAddress, p2wsh.address, commitAmount);
  const commitVout = commit.decoded.vout.find((v) => {
    const addr = v?.scriptPubKey?.address || (Array.isArray(v?.scriptPubKey?.addresses) ? v.scriptPubKey.addresses[0] : '');
    return addr === p2wsh.address;
  });
  if (!commitVout) throw new Error(`Commit output to ${p2wsh.address} not found`);

  const revealSpend = buildRevealSpend(commit.txid, Number(commitVout.n), sats(commitVout.value), reveal.script, revealDestination);
  const revealAccept = BROADCAST
    ? await client.rpcCall('testmempoolaccept', [[revealSpend.hex]], false)
    : null;
  const revealTxid = BROADCAST ? await client.sendrawtransaction(revealSpend.hex) : bitcoin.Transaction.fromHex(revealSpend.hex).getId();
  const registry = await PnlRouteRegistry.recordEnvelope(envelope, {
    revealTxid,
    commitTxid: commit.txid,
    block,
    challengeBlocks: process.env.TL_PNL_ROUTE_CHALLENGE_BLOCKS
  });

  const summary = {
    run: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    broadcast: BROADCAST,
    sourceArtifact: SOURCE_ARTIFACT,
    oracleAddress,
    revealDestination,
    payloadHash,
    witness: {
      payloadBytes: reveal.payloadBytes,
      scriptBytes: reveal.scriptBytes,
      limit: WITNESS_LIMIT,
      p2wshAddress: p2wsh.address
    },
    commit: {
      txid: commit.txid,
      vout: Number(commitVout.n),
      amount: Number(commitVout.value),
      mempoolAccept: commit.accept
    },
    reveal: {
      txid: revealTxid,
      mempoolAccept: revealAccept,
      output: revealSpend.output,
      feeSats: revealSpend.feeSats
    },
    registry: {
      status: registry.status,
      routeHash: registry.routeHash,
      payoutVectorHash: registry.payoutVectorHash,
      tokenPnlHash: registry.tokenPnlHash,
      challengeDeadlineBlock: registry.challengeDeadlineBlock
    },
    payload
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ artifactPath: OUT, summary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
