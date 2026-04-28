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
const DEFAULT_ARTIFACT = path.join('artifacts', 'btctest-vwap-trades-latest.json');
const DEFAULT_SETUP_ARTIFACT = path.join('artifacts', 'btctest-tradelayer-demo-setup-latest.json');
const DEFAULT_CROSS_DOMAIN_ARTIFACT = path.join('artifacts', 'btctest-cross-domain-demo-latest.json');
const EXPLORER_BASE = 'https://mempool.space/testnet4/tx/';
const OP_RETURN_LIMIT = 80;
const FUEL_BTC = 0.00002500;

const TRADE_PRINTS = [
  { id: 'p64900', price: 64900, baseSats: 2000000 },
  { id: 'p65000', price: 65000, baseSats: 3000000 },
  { id: 'p65080', price: 65080, baseSats: 5000000 }
];

function parseArgs(argv) {
  const out = {
    bitcoinBin: process.env.BITCOIN_BIN || '',
    datadir: process.env.BTCTEST_DATADIR || '',
    wallet: process.env.BTCTEST_WALLET || DEFAULT_WALLET,
    adminAddress: process.env.TL_ADMIN_ADDRESS || DEFAULT_BTCTEST_ADMIN_ADDRESS,
    artifact: process.env.TL_BTCTEST_VWAP_ARTIFACT || DEFAULT_ARTIFACT,
    setupArtifact: process.env.TL_BTCTEST_SETUP_ARTIFACT || DEFAULT_SETUP_ARTIFACT,
    crossDomainArtifact: process.env.TL_BTCTEST_CROSS_DOMAIN_ARTIFACT || DEFAULT_CROSS_DOMAIN_ARTIFACT,
    dryRun: false
  };
  for (const arg of argv) {
    if (arg.startsWith('--bitcoin-bin=')) out.bitcoinBin = arg.slice('--bitcoin-bin='.length);
    else if (arg.startsWith('--datadir=')) out.datadir = arg.slice('--datadir='.length);
    else if (arg.startsWith('--wallet=')) out.wallet = arg.slice('--wallet='.length);
    else if (arg.startsWith('--admin=')) out.adminAddress = arg.slice('--admin='.length);
    else if (arg.startsWith('--artifact=')) out.artifact = arg.slice('--artifact='.length);
    else if (arg.startsWith('--setup-artifact=')) out.setupArtifact = arg.slice('--setup-artifact='.length);
    else if (arg.startsWith('--cross-domain-artifact=')) out.crossDomainArtifact = arg.slice('--cross-domain-artifact='.length);
    else if (arg === '--dry-run') out.dryRun = true;
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

function asciiHex(value) {
  return Buffer.from(String(value), 'utf8').toString('hex');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function compactHash(value, bytes = 8) {
  return sha256Hex(value).slice(0, bytes * 2);
}

function ensureTlPayload(txType, encoded) {
  if (String(encoded).startsWith('tl')) return encoded;
  return `tl${Number(txType).toString(36)}${encoded}`;
}

function btcAmount(value) {
  return Number(value).toFixed(8);
}

function resolveMaybe(relativeOrAbsolute) {
  if (!relativeOrAbsolute) return null;
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(process.cwd(), relativeOrAbsolute);
}

function loadArtifact(filePath) {
  const resolved = resolveMaybe(filePath);
  if (!resolved || !fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function findStep(artifact, label) {
  return artifact?.steps?.find((step) => step.label === label) || null;
}

function buildTradePrints() {
  return TRADE_PRINTS.map((trade) => {
    const quoteMicrousd = BigInt(trade.baseSats) * BigInt(trade.price) / 100n;
    if (quoteMicrousd % 1000000n !== 0n) {
      throw new Error(`trade ${trade.id} does not produce whole tlUSD units`);
    }
    return {
      ...trade,
      baseAmount: trade.baseSats / 100000000,
      quoteAmount: Number(quoteMicrousd / 1000000n),
      quoteMicrousd: quoteMicrousd.toString()
    };
  });
}

function buildVwapSummary(trades, context) {
  const totalBaseAmountSats = trades.reduce((sum, trade) => sum + BigInt(trade.baseSats), 0n);
  const totalQuoteAmountMicrousd = trades.reduce((sum, trade) => sum + BigInt(trade.quoteMicrousd), 0n);
  const vwapPrice = totalQuoteAmountMicrousd * 100n / totalBaseAmountSats;
  const vwapScaledPrice = vwapPrice * 10000n;
  const lastAcceptedPrice = 65000n;
  const deviationBps = (vwapPrice > lastAcceptedPrice ? vwapPrice - lastAcceptedPrice : lastAcceptedPrice - vwapPrice) * 10000n / lastAcceptedPrice;
  const validTradeSetRoot = sha256Hex(JSON.stringify(trades.map((trade) => ({
    id: trade.id,
    price: trade.price,
    baseSats: trade.baseSats,
    quoteMicrousd: trade.quoteMicrousd
  }))));
  const summaryCore = {
    pair: 'BTCUSD',
    baseTokenId: 'tlBTC',
    basePropertyId: 1,
    quoteTokenId: 'tlUSD',
    quotePropertyId: 2,
    windowStartHeight: context.windowStartHeight,
    windowEndHeight: context.windowEndHeight,
    stateSnapshotRoot: sha256Hex(`btctest:vwap:${context.windowStartHeight}:${context.windowEndHeight}`),
    tlbtcBalanceRoot: sha256Hex('btctest:vwap:tlbtc-balances'),
    tlusdBalanceRoot: sha256Hex('btctest:vwap:tlusd-balances'),
    validTradeSetRoot,
    validTradeCount: trades.length,
    totalBaseAmountSats: totalBaseAmountSats.toString(),
    totalQuoteAmountMicrousd: totalQuoteAmountMicrousd.toString(),
    vwapPrice: vwapPrice.toString(),
    vwapScaledPrice: vwapScaledPrice.toString(),
    maxDeviationBps: 500,
    priceDeviationBps: Number(deviationBps)
  };
  return {
    ...summaryCore,
    summaryCommitmentId: sha256Hex(JSON.stringify(summaryCore)),
    payloadHash: compactHash(JSON.stringify(summaryCore), 16),
    blobRef: `vwap${compactHash(validTradeSetRoot, 2)}`
  };
}

function buildPlan(config, context) {
  const manifest = buildActivationManifest({ network: 'BTCTEST' });
  const trades = buildTradePrints();
  const vwap = buildVwapSummary(trades, context);

  const steps = [
    {
      phase: 'activation',
      txType: 0,
      label: 'activate-5-token-vwap-trades',
      description: 'Activate TradeLayer tx5 for on-chain token-for-token tlBTC/tlUSD trade prints',
      payload: Encode.encodeActivateTradeLayer({
        txTypeToActivate: 5,
        codeHash: manifest.codeHash
      })
    },
    {
      phase: 'synthetic',
      txType: 24,
      label: 'mint-vwap-tlusd-liquidity',
      description: 'Mint USD synthetic liquidity from the BTC/USD inverse envelope before printing spot VWAP trades',
      payload: Encode.encodeMintSynthetic({
        propertyIdUsed: 1,
        contractIdUsed: 1,
        amount: 6502
      })
    }
  ];

  for (const trade of trades) {
    steps.push(
      {
        phase: 'vwap-trade',
        txType: 5,
        tradePrintId: trade.id,
        side: 'sell-tlbtc',
        label: `vwap-sell-tlbtc-${trade.price}`,
        description: `${trade.baseAmount.toFixed(8)} tlBTC offered for ${trade.quoteAmount} tlUSD`,
        payload: Encode.encodeOnChainTokenForToken({
          propertyIdOffered: 1,
          propertyIdDesired: 2,
          amountOffered: trade.baseAmount,
          amountExpected: trade.quoteAmount,
          stop: false,
          post: true
        })
      },
      {
        phase: 'vwap-trade',
        txType: 5,
        tradePrintId: trade.id,
        side: 'sell-tlusd',
        label: `vwap-sell-tlusd-${trade.price}`,
        description: `${trade.quoteAmount} tlUSD offered for ${trade.baseAmount.toFixed(8)} tlBTC`,
        payload: Encode.encodeOnChainTokenForToken({
          propertyIdOffered: 2,
          propertyIdDesired: 1,
          amountOffered: trade.quoteAmount,
          amountExpected: trade.baseAmount,
          stop: false,
          post: true
        })
      }
    );
  }

  steps.push({
    phase: 'oracle',
    txType: 14,
    label: 'publish-vwap-state-oracle',
    description: 'Publish compact VWAP state commitment over the valid tlBTC/tlUSD trade set',
    payload: Encode.encodePublishOracleData({
      oracleId: 1,
      kind: 'state',
      propertyId: 2,
      windowStartBlock: context.windowStartHeight,
      windowEndBlock: context.windowEndHeight,
      payloadHash: vwap.payloadHash,
      blobRef: vwap.blobRef
    })
  });

  return {
    manifest,
    trades,
    vwap,
    steps: steps.map((step) => ({
      ...step,
      payload: ensureTlPayload(step.txType, step.payload)
    }))
  };
}

function validatePlan(steps) {
  for (const step of steps) {
    const bytes = Buffer.byteLength(step.payload, 'utf8');
    if (bytes > OP_RETURN_LIMIT) {
      throw new Error(`${step.label} payload is ${bytes} bytes, above ${OP_RETURN_LIMIT}: ${step.payload}`);
    }
  }
}

function buildOutputs(step) {
  return [{ data: asciiHex(step.payload) }];
}

function decodeRawTransaction(config, hex) {
  return JSON.parse(bitcoinCli(config, ['decoderawtransaction', hex]));
}

function getChainHeight(config) {
  if (config.dryRun) return 132900;
  const info = JSON.parse(bitcoinCli(config, ['getblockchaininfo']));
  return Number(info.blocks || 0);
}

function getNewAddress(config, label) {
  if (config.dryRun) return `tb1q${compactHash(label, 19)}`;
  return bitcoinCli(config, ['getnewaddress', label, 'bech32']);
}

function broadcastFundedFanout(config, firstStep, fuelCount) {
  const outputs = buildOutputs(firstStep);
  const fuelAddresses = [];
  for (let i = 0; i < fuelCount; i += 1) {
    const address = getNewAddress(config, `vwap-trade-fuel-${i + 1}`);
    fuelAddresses.push(address);
    outputs.push({ [address]: Number(btcAmount(FUEL_BTC)) });
  }
  const raw = bitcoinCli(config, ['createrawtransaction', '[]', JSON.stringify(outputs)]);
  const options = JSON.stringify({
    fee_rate: 2,
    changeAddress: config.adminAddress,
    include_unsafe: true
  });
  const funded = JSON.parse(bitcoinCli(config, ['fundrawtransaction', raw, options]));
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', funded.hex]));
  if (!signed.complete) throw new Error(`wallet did not fully sign ${firstStep.label}`);
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  const decoded = decodeRawTransaction(config, signed.hex);
  const fuelOutpoints = decoded.vout
    .filter((output) => {
      const address = output.scriptPubKey && output.scriptPubKey.address;
      return fuelAddresses.includes(address) && Number(output.value) === Number(btcAmount(FUEL_BTC));
    })
    .map((output) => ({
      txid,
      vout: output.n,
      valueBtc: Number(output.value),
      address: output.scriptPubKey.address
    }));
  if (fuelOutpoints.length < fuelCount) {
    throw new Error(`fanout only created ${fuelOutpoints.length}/${fuelCount} fuel outputs`);
  }
  return {
    sent: sentStep(firstStep, txid, funded.fee, { fuelOutpoints }),
    fuelOutpoints
  };
}

function broadcastFuelStep(config, step, outpoint) {
  const inputs = JSON.stringify([{ txid: outpoint.txid, vout: outpoint.vout }]);
  const raw = bitcoinCli(config, ['createrawtransaction', inputs, JSON.stringify(buildOutputs(step))]);
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', raw]));
  if (!signed.complete) throw new Error(`wallet did not fully sign ${step.label}`);
  const decoded = decodeRawTransaction(config, signed.hex);
  const inputSats = Math.round(Number(outpoint.valueBtc) * 100000000);
  const outputSats = decoded.vout.reduce((sum, output) => sum + Math.round(Number(output.value) * 100000000), 0);
  const feeBtc = (inputSats - outputSats) / 100000000;
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  return sentStep(step, txid, feeBtc, { fuelInput: outpoint });
}

function sentStep(step, txid, feeBtc, extra = {}) {
  return {
    ...step,
    payloadBytes: Buffer.byteLength(step.payload, 'utf8'),
    payloadHex: asciiHex(step.payload),
    txid,
    feeBtc,
    explorer: `${EXPLORER_BASE}${txid}`,
    ...extra
  };
}

function dryStep(step) {
  return {
    ...step,
    payloadBytes: Buffer.byteLength(step.payload, 'utf8'),
    payloadHex: asciiHex(step.payload),
    txid: null,
    explorer: null,
    outputs: buildOutputs(step)
  };
}

function tradePrintArtifacts(trades, steps) {
  return trades.map((trade) => {
    const maker = steps.find((step) => step.tradePrintId === trade.id && step.side === 'sell-tlbtc');
    const taker = steps.find((step) => step.tradePrintId === trade.id && step.side === 'sell-tlusd');
    return {
      id: trade.id,
      price: String(trade.price),
      baseAmountSats: String(trade.baseSats),
      quoteAmountMicrousd: trade.quoteMicrousd,
      makerTxid: maker?.txid || null,
      makerExplorer: maker?.explorer || null,
      takerTxid: taker?.txid || null,
      takerExplorer: taker?.explorer || null
    };
  });
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const setupArtifact = loadArtifact(config.setupArtifact);
  const crossDomainArtifact = loadArtifact(config.crossDomainArtifact);
  const chainHeight = getChainHeight(config);
  const context = {
    windowStartHeight: Math.max(1, chainHeight - 6),
    windowEndHeight: chainHeight + 6,
    setupArtifact: config.setupArtifact,
    crossDomainArtifact: config.crossDomainArtifact,
    sourceTokenIssueTxids: {
      tlbtc: findStep(setupArtifact, 'issue-tlbtc')?.txid || null,
      tlusd: findStep(setupArtifact, 'issue-tlusd')?.txid || null
    },
    sourceStablecoinMintTxids: [
      findStep(setupArtifact, 'mint-demo-tlusd')?.txid || null,
      findStep(crossDomainArtifact, 'short-mints-tlusd')?.txid || null
    ].filter(Boolean)
  };
  const plan = buildPlan(config, context);
  validatePlan(plan.steps);

  const result = {
    kind: 'tradelayer_btctest_vwap_trade_history',
    network: 'BTCTEST',
    bitcoinNetwork: 'testnet4',
    adminAddress: config.adminAddress,
    startedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    context,
    vwap: plan.vwap,
    steps: []
  };

  if (config.dryRun) {
    result.steps = plan.steps.map(dryStep);
  } else {
    const tail = plan.steps.slice(1);
    const fanout = broadcastFundedFanout(config, plan.steps[0], tail.length);
    result.steps.push(fanout.sent);
    console.log(JSON.stringify({
      label: fanout.sent.label,
      phase: fanout.sent.phase,
      txid: fanout.sent.txid,
      explorer: fanout.sent.explorer
    }));
    for (let i = 0; i < tail.length; i += 1) {
      const sent = broadcastFuelStep(config, tail[i], fanout.fuelOutpoints[i]);
      result.steps.push(sent);
      console.log(JSON.stringify({
        label: sent.label,
        phase: sent.phase,
        txid: sent.txid,
        explorer: sent.explorer
      }));
    }
  }

  result.tradePrints = tradePrintArtifacts(plan.trades, result.steps);
  result.vwap.validTrades = result.tradePrints.map((trade) => ({
    txid: trade.makerTxid,
    counterTxid: trade.takerTxid,
    baseAmountSats: trade.baseAmountSats,
    impliedPrice: trade.price
  }));
  result.vwap.publishTxid = result.steps.find((step) => step.label === 'publish-vwap-state-oracle')?.txid || null;
  result.vwap.publishExplorer = result.steps.find((step) => step.label === 'publish-vwap-state-oracle')?.explorer || null;
  result.finishedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(config.artifact), { recursive: true });
  fs.writeFileSync(config.artifact, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    artifact: path.resolve(config.artifact),
    steps: result.steps.length,
    txids: result.steps.map((step) => step.txid).filter(Boolean),
    vwapPrice: result.vwap.vwapPrice,
    publishTxid: result.vwap.publishTxid
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
  buildTradePrints,
  buildVwapSummary,
  buildPlan,
  validatePlan
};
