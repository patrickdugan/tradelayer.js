#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const Encode = require('../src/txEncoder');

const DEFAULT_WALLET = 'utxoref-testnet';
const DEFAULT_ARTIFACT = path.join('artifacts', 'btctest-cross-domain-demo-latest.json');
const OP_RETURN_LIMIT = 80;

function parseArgs(argv) {
  const out = {
    bitcoinBin: process.env.BITCOIN_BIN || '',
    datadir: process.env.BTCTEST_DATADIR || '',
    wallet: process.env.BTCTEST_WALLET || DEFAULT_WALLET,
    artifact: process.env.TL_BTCTEST_CROSS_DOMAIN_ARTIFACT || DEFAULT_ARTIFACT
  };
  for (const arg of argv) {
    if (arg.startsWith('--bitcoin-bin=')) out.bitcoinBin = arg.slice('--bitcoin-bin='.length);
    else if (arg.startsWith('--datadir=')) out.datadir = arg.slice('--datadir='.length);
    else if (arg.startsWith('--wallet=')) out.wallet = arg.slice('--wallet='.length);
    else if (arg.startsWith('--artifact=')) out.artifact = arg.slice('--artifact='.length);
  }
  return out;
}

function cliPath(bitcoinBin) {
  if (bitcoinBin) return path.join(bitcoinBin, process.platform === 'win32' ? 'bitcoin-cli.exe' : 'bitcoin-cli');
  return process.platform === 'win32' ? 'bitcoin-cli.exe' : 'bitcoin-cli';
}

function bitcoinCli(config, args) {
  const baseArgs = ['-chain=testnet4', `-rpcwallet=${config.wallet}`, ...args];
  if (config.datadir) baseArgs.unshift(`-datadir=${config.datadir}`);
  return execFileSync(cliPath(config.bitcoinBin), baseArgs, { encoding: 'utf8' }).trim();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function compactHash(value, bytes = 5) {
  return sha256Hex(value).slice(0, bytes * 2);
}

function asciiHex(value) {
  return Buffer.from(String(value), 'utf8').toString('hex');
}

function ensureTlPayload(txType, encoded) {
  if (String(encoded).startsWith('tl')) return encoded;
  return `tl${Number(txType).toString(36)}${encoded}`;
}

function btcAmount(value) {
  return Number(value).toFixed(8);
}

function decodeRaw(config, hex) {
  return JSON.parse(bitcoinCli(config, ['decoderawtransaction', hex]));
}

function signAndSend(config, raw, fundOptions = null) {
  const hex = fundOptions
    ? JSON.parse(bitcoinCli(config, ['fundrawtransaction', raw, JSON.stringify(fundOptions)])).hex
    : raw;
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', hex]));
  if (!signed.complete) throw new Error('wallet did not fully sign replacement tx');
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  return { txid, hex: signed.hex };
}

function p2trAnchor(decoded) {
  const output = decoded.vout.find((vout) => {
    const type = String(vout.scriptPubKey?.type || '').toLowerCase();
    const address = String(vout.scriptPubKey?.address || '').toLowerCase();
    return type === 'witness_v1_taproot' || address.startsWith('tb1p') || address.startsWith('bc1p');
  });
  if (!output) throw new Error('replacement tx did not create a P2TR anchor output');
  return {
    vout: output.n,
    valueBtc: Number(output.value),
    valueSats: Math.round(Number(output.value) * 100000000),
    address: output.scriptPubKey.address,
    scriptType: output.scriptPubKey.type
  };
}

function buildPayloads() {
  const entryState = compactHash('inverse-entry:btcusd:65000:short', 8);
  const tapAssetId = 'tap' + compactHash('tlusd-tap-asset', 4);
  const coloredCommitment = 'cc' + compactHash('tlusd-colored-pledge', 4);
  const pledgePayload = ensureTlPayload(33, Encode.encodeColoredCoin({
    encodeDecodeRecode: 1,
    propertyId: 2,
    satsRatio: 1,
    homeAddress: 'ln',
    amount: 25,
    coloredOutputRef: '1',
    tapAssetId,
    proofRoot: 'p' + compactHash(coloredCommitment, 3),
    rfqId: 'rfq2',
    bitvmStatusRef: 'b' + compactHash(entryState, 3),
    commitmentId: coloredCommitment
  }));
  const tapPayload = ensureTlPayload(33, Encode.encodeColoredCoin({
    encodeDecodeRecode: 2,
    propertyId: 2,
    satsRatio: 1,
    homeAddress: 'tap',
    amount: 25,
    coloredOutputRef: '1',
    tapAssetId,
    proofRoot: 'p' + compactHash(`tap:${coloredCommitment}`, 3),
    rfqId: 'rfq2',
    bitvmStatusRef: 'b' + compactHash(entryState, 3),
    commitmentId: coloredCommitment,
    previousOutputRef: '1',
    newColoredOutputRef: '1'
  }));

  for (const [label, payload] of [['pledge', pledgePayload], ['tap', tapPayload]]) {
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > OP_RETURN_LIMIT) throw new Error(`${label} payload is ${bytes} bytes, above ${OP_RETURN_LIMIT}`);
  }

  return { pledgePayload, tapPayload, tapAssetId, coloredCommitment };
}

function replaceStep(artifact, label, patch) {
  const index = artifact.steps.findIndex((step) => step.label === label);
  if (index < 0) throw new Error(`missing artifact step ${label}`);
  artifact.steps[index] = {
    ...artifact.steps[index],
    ...patch
  };
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const artifact = JSON.parse(fs.readFileSync(config.artifact, 'utf8'));
  const { pledgePayload, tapPayload, tapAssetId, coloredCommitment } = buildPayloads();
  const pledgeAddress = bitcoinCli(config, ['getnewaddress', 'tx33-pledge-p2tr-anchor', 'bech32m']);
  const tapAddress = bitcoinCli(config, ['getnewaddress', 'tx33-tap-asset-p2tr-anchor', 'bech32m']);

  const pledgeRaw = bitcoinCli(config, [
    'createrawtransaction',
    '[]',
    JSON.stringify([
      { data: asciiHex(pledgePayload) },
      { [pledgeAddress]: Number(btcAmount(0.00010000)) }
    ])
  ]);
  const pledgeSent = signAndSend(config, pledgeRaw, {
    fee_rate: 2,
    include_unsafe: true
  });
  const pledgeDecoded = decodeRaw(config, pledgeSent.hex);
  const pledgeAnchor = p2trAnchor(pledgeDecoded);
  pledgeAnchor.outpoint = `${pledgeSent.txid}:${pledgeAnchor.vout}`;

  const tapRaw = bitcoinCli(config, [
    'createrawtransaction',
    JSON.stringify([{ txid: pledgeSent.txid, vout: pledgeAnchor.vout }]),
    JSON.stringify([
      { data: asciiHex(tapPayload) },
      { [tapAddress]: Number(btcAmount(0.00005000)) }
    ])
  ]);
  const tapSent = signAndSend(config, tapRaw);
  const tapDecoded = decodeRaw(config, tapSent.hex);
  const tapAnchor = p2trAnchor(tapDecoded);
  tapAnchor.outpoint = `${tapSent.txid}:${tapAnchor.vout}`;
  tapAnchor.previousOutpoint = pledgeAnchor.outpoint;

  replaceStep(artifact, 'pledge-tlusd-hybrid-colored', {
    description: 'Pledge tlUSD into hybrid colored coin form with a P2TR reference output',
    payload: pledgePayload,
    payloadHex: asciiHex(pledgePayload),
    payloadBytes: Buffer.byteLength(pledgePayload, 'utf8'),
    txid: pledgeSent.txid,
    explorer: `https://mempool.space/testnet4/tx/${pledgeSent.txid}`,
    tapAssetId,
    coloredCommitment,
    p2trAnchor: pledgeAnchor
  });

  replaceStep(artifact, 'make-tap-asset-tlusd', {
    description: 'Create a P2TR TAP asset anchor output for the pledged tlUSD',
    payload: tapPayload,
    payloadHex: asciiHex(tapPayload),
    payloadBytes: Buffer.byteLength(tapPayload, 'utf8'),
    txid: tapSent.txid,
    explorer: `https://mempool.space/testnet4/tx/${tapSent.txid}`,
    tapAssetId,
    coloredCommitment,
    p2trAnchor: tapAnchor
  });

  artifact.context = {
    ...(artifact.context || {}),
    tx33PledgeAnchorOutpoint: pledgeAnchor.outpoint,
    tapAssetAnchorOutpoint: tapAnchor.outpoint
  };
  artifact.generatedAt = new Date().toISOString();
  artifact.replacement = {
    reason: 'tx33 TAP hybrid steps require P2TR reference outputs, not OP_RETURN-only markers',
    replacedAt: artifact.generatedAt,
    pledgeTxid: pledgeSent.txid,
    tapTxid: tapSent.txid
  };

  fs.writeFileSync(config.artifact, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    artifact: path.resolve(config.artifact),
    pledgeTxid: pledgeSent.txid,
    pledgeAnchor: pledgeAnchor.outpoint,
    tapTxid: tapSent.txid,
    tapAnchor: tapAnchor.outpoint
  }, null, 2));
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
  buildPayloads,
  parseArgs
};
