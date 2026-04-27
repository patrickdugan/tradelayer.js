#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const Encode = require('../src/txEncoder');
const {
  buildActivationManifest,
  DEFAULT_BTCTEST_ADMIN_ADDRESS
} = require('./testnetActivationProfile');

const DEFAULT_WALLET = 'utxoref-testnet';
const OP_RETURN_LIMIT = 80;

function parseArgs(argv) {
  const out = {
    bitcoinBin: process.env.BITCOIN_BIN || '',
    datadir: process.env.BTCTEST_DATADIR || '',
    wallet: process.env.BTCTEST_WALLET || DEFAULT_WALLET,
    adminAddress: process.env.TL_ADMIN_ADDRESS || DEFAULT_BTCTEST_ADMIN_ADDRESS,
    artifact: process.env.TL_BTCTEST_SETUP_ARTIFACT || path.join('artifacts', 'btctest-tradelayer-demo-setup-latest.json'),
    dryRun: false
  };
  for (const arg of argv) {
    if (arg.startsWith('--bitcoin-bin=')) out.bitcoinBin = arg.slice('--bitcoin-bin='.length);
    else if (arg.startsWith('--datadir=')) out.datadir = arg.slice('--datadir='.length);
    else if (arg.startsWith('--wallet=')) out.wallet = arg.slice('--wallet='.length);
    else if (arg.startsWith('--admin=')) out.adminAddress = arg.slice('--admin='.length);
    else if (arg.startsWith('--artifact=')) out.artifact = arg.slice('--artifact='.length);
    else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

function asciiHex(value) {
  return Buffer.from(String(value), 'utf8').toString('hex');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureTlPayload(txType, encoded) {
  if (String(encoded).startsWith('tl')) return encoded;
  return `tl${Number(txType).toString(36)}${encoded}`;
}

function compactHash(value, bytes = 8) {
  return sha256Hex(value).slice(0, bytes * 2);
}

function buildDemoPayloads() {
  const manifest = buildActivationManifest({ network: 'BTCTEST' });
  const activationTxTypes = [0, 1, 13, 14, 16, 19, 24, 30, 33];
  const payloads = activationTxTypes.map((txType) => ({
    phase: 'activation',
    txType,
    label: `activate-${txType}`,
    payload: Encode.encodeActivateTradeLayer({
      txTypeToActivate: txType,
      codeHash: manifest.codeHash
    })
  }));

  payloads.push(
    {
      phase: 'asset',
      txType: 1,
      label: 'issue-tlbtc',
      payload: Encode.encodeTokenIssue({
        initialAmount: 21000000,
        ticker: 'tlBTC',
        whitelists: [],
        managed: true,
        backupAddress: '',
        nft: false,
        coloredCoinHybrid: false,
        proceduralType: 0
      })
    },
    {
      phase: 'asset',
      txType: 1,
      label: 'issue-tlusd',
      payload: Encode.encodeTokenIssue({
        initialAmount: 0,
        ticker: 'tlUSD',
        whitelists: [],
        managed: true,
        backupAddress: '',
        nft: false,
        coloredCoinHybrid: true,
        proceduralType: 0
      })
    },
    {
      phase: 'oracle',
      txType: 13,
      label: 'create-btcusd-oracle',
      payload: Encode.encodeCreateOracle({
        ticker: 'BTCUSD',
        url: 'btc.usd',
        backupAddress: '',
        whitelists: [],
        lag: 1
      })
    },
    {
      phase: 'oracle',
      txType: 14,
      label: 'publish-btcusd-65000',
      payload: Encode.encodePublishOracleData({
        oracleid: 1,
        price: 65000
      })
    },
    {
      phase: 'perp',
      txType: 16,
      label: 'create-btcusd-perp-series',
      payload: Encode.encodeCreateFutureContractSeries({
        native: false,
        underlyingOracleId: 1,
        onChainData: [],
        notionalPropertyId: 2,
        notionalValue: 1,
        collateralPropertyId: 1,
        leverage: 2,
        expiryPeriod: 144,
        series: 1,
        inverse: false,
        fee: false
      })
    },
    {
      phase: 'synthetic',
      txType: 24,
      label: 'mint-demo-tlusd',
      payload: Encode.encodeMintSynthetic({
        propertyIdUsed: 1,
        contractIdUsed: 1,
        amount: 100
      })
    }
  );

  const dlcRef = 'dlc' + compactHash('btctest-dlc-template', 3);
  const stateHash = compactHash('FUNDED:tlbtc:tlusd:btcusd:65000', 8);
  payloads.push({
    phase: 'bitvm',
    txType: 30,
    label: 'relay-bitvm-dlc-funded',
    payload: Encode.encodeStakeFraudProof({
      action: 2,
      oracleId: 1,
      stakedPropertyId: 1,
      amount: 0,
      relayType: 1,
      stateHash,
      dlcRef,
      settlementState: 'FUNDED',
      relayBlob: '',
      autoRoll: true,
      nextDlcRef: 'roll' + compactHash('next-dlc-ref', 3)
    })
  });

  const tx33Payload = ensureTlPayload(33, Encode.encodeColoredCoin({
    encodeDecodeRecode: 1,
    propertyId: 2,
    satsRatio: 1,
    homeAddress: 'lnedge',
    amount: 25,
    coloredOutputRef: 'u1',
    tapAssetId: 'tap1',
    proofRoot: 'p' + compactHash('tap-proof-root', 3),
    rfqId: 'rfq1',
    bitvmStatusRef: 'b' + compactHash(stateHash, 3),
    commitmentId: 'c' + compactHash('tlusd-commitment', 3)
  }));
  payloads.push({
    phase: 'externalization',
    txType: 33,
    label: 'externalize-tlusd-tx33',
    payload: tx33Payload
  });

  return payloads.map((item) => ({
    ...item,
    payload: ensureTlPayload(item.txType, item.payload)
  }));
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

function broadcastPayload(config, item) {
  const dataHex = asciiHex(item.payload);
  const outputs = JSON.stringify([{ data: dataHex }]);
  const raw = bitcoinCli(config, ['createrawtransaction', '[]', outputs]);
  const options = JSON.stringify({
    fee_rate: 1,
    changeAddress: config.adminAddress,
    include_unsafe: true
  });
  const funded = JSON.parse(bitcoinCli(config, ['fundrawtransaction', raw, options]));
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', funded.hex]));
  if (!signed.complete) throw new Error(`wallet did not fully sign ${item.label}`);
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  return {
    ...item,
    payloadBytes: Buffer.byteLength(item.payload, 'utf8'),
    payloadHex: dataHex,
    txid,
    feeBtc: funded.fee,
    explorer: `https://mempool.space/testnet4/tx/${txid}`
  };
}

function validatePayloads(payloads) {
  for (const item of payloads) {
    const bytes = Buffer.byteLength(item.payload, 'utf8');
    if (bytes > OP_RETURN_LIMIT) {
      throw new Error(`${item.label} payload is ${bytes} bytes, above ${OP_RETURN_LIMIT}`);
    }
  }
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const payloads = buildDemoPayloads();
  validatePayloads(payloads);

  const startedAt = new Date().toISOString();
  const result = {
    kind: 'tradelayer_btctest_demo_setup',
    network: 'BTCTEST',
    bitcoinNetwork: 'testnet4',
    adminAddress: config.adminAddress,
    startedAt,
    dryRun: config.dryRun,
    steps: []
  };

  if (config.dryRun) {
    result.steps = payloads.map((item) => ({
      ...item,
      payloadBytes: Buffer.byteLength(item.payload, 'utf8'),
      payloadHex: asciiHex(item.payload)
    }));
  } else {
    for (const item of payloads) {
      const sent = broadcastPayload(config, item);
      result.steps.push(sent);
      console.log(JSON.stringify({
        label: sent.label,
        txType: sent.txType,
        txid: sent.txid,
        explorer: sent.explorer
      }));
    }
  }

  result.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(config.artifact), { recursive: true });
  fs.writeFileSync(config.artifact, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: true,
    artifact: path.resolve(config.artifact),
    steps: result.steps.length,
    txids: result.steps.map((step) => step.txid).filter(Boolean)
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
  parseArgs,
  buildDemoPayloads,
  validatePayloads,
  broadcastPayload
};
