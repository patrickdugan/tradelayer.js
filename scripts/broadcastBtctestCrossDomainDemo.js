#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const Encode = require('../src/txEncoder');
const { DEFAULT_BTCTEST_ADMIN_ADDRESS } = require('./testnetActivationProfile');

const DEFAULT_WALLET = 'utxoref-testnet';
const OP_RETURN_LIMIT = 80;
const DUST_BTC = 0.00000546;
const FUEL_BTC = 0.00002500;

function parseArgs(argv) {
  const out = {
    bitcoinBin: process.env.BITCOIN_BIN || '',
    datadir: process.env.BTCTEST_DATADIR || '',
    wallet: process.env.BTCTEST_WALLET || DEFAULT_WALLET,
    adminAddress: process.env.TL_ADMIN_ADDRESS || DEFAULT_BTCTEST_ADMIN_ADDRESS,
    artifact: process.env.TL_BTCTEST_CROSS_DOMAIN_ARTIFACT || path.join('artifacts', 'btctest-cross-domain-demo-latest.json'),
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

function compactHash(value, bytes = 5) {
  return sha256Hex(value).slice(0, bytes * 2);
}

function ensureTlPayload(txType, encoded) {
  if (String(encoded).startsWith('tl')) return encoded;
  return `tl${Number(txType).toString(36)}${encoded}`;
}

function btcAmount(value) {
  return Number(value).toFixed(8);
}

function getNewAddress(config, label) {
  if (config.dryRun) return `tb1q${compactHash(label, 19)}`;
  return bitcoinCli(config, ['getnewaddress', label, 'bech32']);
}

function getNewTaprootAddress(config, label) {
  if (config.dryRun) return `tb1p${compactHash(label, 19)}`;
  return bitcoinCli(config, ['getnewaddress', label, 'bech32m']);
}

function buildDemoPlan(context) {
  const dlcTemplateId = 'tpl' + compactHash('cross-domain-dlc-template', 2);
  const dlcContractId = 'ct' + compactHash('cross-domain-dlc-contract', 2);
  const counterpartyRef = 'cp' + compactHash(context.counterpartyAddress, 3);
  const routerRef = 'rt' + compactHash(context.routerAddress, 3);
  const dlcRef = 'dlc' + compactHash(`${dlcTemplateId}:${dlcContractId}`, 3);
  const entryState = compactHash('inverse-entry:btcusd:65000:short', 8);
  const arkState = compactHash('ark:graft:tlusd:tap:batch', 8);
  const tapAssetId = 'tap' + compactHash('tlusd-tap-asset', 4);
  const coloredCommitment = 'cc' + compactHash('tlusd-colored-pledge', 4);

  return [
    {
      phase: 'funding',
      label: 'subswap-dlc-funding',
      description: 'LN submarine swap shaped funding output enters the DLC template',
      payload: `UTXORef:subswap:${dlcRef}`,
      outputs: [{ address: context.dlcAddress, amountBtc: DUST_BTC }]
    },
    {
      phase: 'funding',
      label: 'fund-counterparty-address',
      description: 'Second Bitcoin testnet address receives BTC for the opposite side',
      payload: `UTXORef:fund:${counterpartyRef}`,
      outputs: [{ address: context.counterpartyAddress, amountBtc: DUST_BTC }]
    },
    {
      phase: 'oracle',
      label: 'create-btcusd-oracle',
      txType: 13,
      description: 'Create the BTC/USD oracle used by the inverse contract',
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
      label: 'publish-btcusd-entry',
      txType: 14,
      description: 'Publish the entry price used by both sides of the DLC/perp envelope',
      payload: Encode.encodePublishOracleData({ oracleid: 1, price: 65000 })
    },
    {
      phase: 'asset',
      label: 'mint-tlbtc-router-dlc',
      txType: 11,
      description: 'Mint tlBTC to the router side against the DLC template',
      payload: Encode.encodeGrantManagedToken({
        propertyId: 1,
        amountGranted: 0.02,
        redeemAddress: routerRef,
        dlcTemplateId,
        dlcContractId,
        settlementState: 'FUNDED',
        dlcHash: compactHash(`router:${dlcContractId}`, 4)
      })
    },
    {
      phase: 'asset',
      label: 'mint-tlbtc-counterparty-dlc',
      txType: 11,
      description: 'Mint tlBTC to the funded second address against the same DLC template',
      payload: Encode.encodeGrantManagedToken({
        propertyId: 1,
        amountGranted: 0.02,
        redeemAddress: counterpartyRef,
        dlcTemplateId,
        dlcContractId,
        settlementState: 'FUNDED',
        dlcHash: compactHash(`counterparty:${dlcContractId}`, 4)
      })
    },
    {
      phase: 'perp',
      label: 'create-inverse-btcusd-contract',
      txType: 16,
      description: 'Create the inverse BTC/USD contract wrapping the DLC status',
      payload: Encode.encodeCreateFutureContractSeries({
        native: false,
        underlyingOracleId: 1,
        onChainData: [],
        notionalPropertyId: 2,
        notionalValue: 1,
        collateralPropertyId: 1,
        leverage: 2,
        expiryPeriod: 144,
        series: 2,
        inverse: true,
        fee: false
      })
    },
    {
      phase: 'trade',
      label: 'router-long-inverse-trade',
      txType: 18,
      description: 'Router side posts the long leg of the inverse contract trade',
      payload: Encode.encodeTradeContractOnchain({
        contractId: 1,
        price: 65000,
        amount: 1,
        sell: false,
        insurance: false,
        reduce: false,
        post: true,
        stop: false
      })
    },
    {
      phase: 'trade',
      label: 'counterparty-short-inverse-trade',
      txType: 18,
      description: 'Funded second address posts the short leg of the inverse contract trade',
      payload: Encode.encodeTradeContractOnchain({
        contractId: 1,
        price: 65000,
        amount: 1,
        sell: true,
        insurance: false,
        reduce: false,
        post: true,
        stop: false
      })
    },
    {
      phase: 'synthetic',
      label: 'short-mints-tlusd',
      txType: 24,
      description: 'Short side mints tlUSD from the inverse BTC/USD contract envelope',
      payload: Encode.encodeMintSynthetic({ propertyIdUsed: 1, contractIdUsed: 1, amount: 49 })
    },
    {
      phase: 'externalization',
      label: 'pledge-tlusd-hybrid-colored',
      txType: 33,
      description: 'Pledge tlUSD into hybrid colored coin form',
      payload: ensureTlPayload(33, Encode.encodeColoredCoin({
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
      })),
      tapAnchorAddress: context.pledgeTapAnchorAddress,
      tapAnchorAmountBtc: 0.00010000
    },
    {
      phase: 'tap',
      label: 'make-tap-asset-tlusd',
      txType: 33,
      description: 'Create a P2TR TAP asset anchor output for the pledged tlUSD',
      payload: ensureTlPayload(33, Encode.encodeColoredCoin({
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
      })),
      tapAnchorAddress: context.tapAssetAnchorAddress,
      tapAnchorAmountBtc: 0.00005000
    },
    {
      phase: 'liquidity',
      label: 'plain-liquidity-graft',
      txType: null,
      proofKind: 'ln-route-commitment',
      description: 'Off-chain Lightning route graft commitment referencing the tlUSD/TAP anchor; no Bitcoin txid is created for route construction',
      payload: `ln-route-graft:${tapAssetId}:tap-anchor-vout-1`
    },
    {
      phase: 'liquidity',
      label: 'ark-liquidity-graft',
      txType: null,
      proofKind: 'ark-vtxo-commitment',
      description: 'Off-chain Ark VTXO assignment compresses the pledged route capital; no Bitcoin txid exists until a round, exit, or forfeit transaction',
      payload: `ark-vtxo-graft:${tapAssetId}:ark-batch-root-${arkState}:tap-anchor-vout-1`
    }
  ].map((step) => ({
    ...step,
    payload: step.txType != null ? ensureTlPayload(step.txType, step.payload) : step.payload
  }));
}

function validatePlan(steps) {
  for (const step of steps) {
    const bytes = Buffer.byteLength(step.payload, 'utf8');
    if (step.proofKind) continue;
    if (bytes > OP_RETURN_LIMIT) {
      throw new Error(`${step.label} payload is ${bytes} bytes, above ${OP_RETURN_LIMIT}: ${step.payload}`);
    }
  }
}

function buildOutputs(step) {
  if (step.tapAnchorAddress) {
    return [
      { data: asciiHex(step.payload) },
      { [step.tapAnchorAddress]: Number(btcAmount(step.tapAnchorAmountBtc || DUST_BTC)) }
    ];
  }

  const outputs = [];
  for (const output of step.outputs || []) {
    outputs.push({ [output.address]: Number(btcAmount(output.amountBtc)) });
  }
  outputs.push({ data: asciiHex(step.payload) });
  return outputs;
}

function broadcastStep(config, step) {
  const outputs = JSON.stringify(buildOutputs(step));
  const raw = bitcoinCli(config, ['createrawtransaction', '[]', outputs]);
  const options = JSON.stringify({
    fee_rate: 1,
    changeAddress: config.adminAddress,
    include_unsafe: true
  });
  const funded = JSON.parse(bitcoinCli(config, ['fundrawtransaction', raw, options]));
  const signed = JSON.parse(bitcoinCli(config, ['signrawtransactionwithwallet', funded.hex]));
  if (!signed.complete) throw new Error(`wallet did not fully sign ${step.label}`);
  const txid = bitcoinCli(config, ['sendrawtransaction', signed.hex]);
  return {
    ...step,
    payloadBytes: Buffer.byteLength(step.payload, 'utf8'),
    payloadHex: asciiHex(step.payload),
    txid,
    feeBtc: funded.fee,
    explorer: `https://mempool.space/testnet4/tx/${txid}`
  };
}

function decodeRawTransaction(config, hex) {
  return JSON.parse(bitcoinCli(config, ['decoderawtransaction', hex]));
}

function broadcastFundedFanout(config, firstStep, fuelCount) {
  const outputs = buildOutputs(firstStep);
  const fuelAddresses = [];
  for (let i = 0; i < fuelCount; i += 1) {
    const address = getNewAddress(config, `cross-domain-proof-fuel-${i + 1}`);
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
    sent: {
      ...firstStep,
      payloadBytes: Buffer.byteLength(firstStep.payload, 'utf8'),
      payloadHex: asciiHex(firstStep.payload),
      txid,
      feeBtc: funded.fee,
      explorer: `https://mempool.space/testnet4/tx/${txid}`,
      fuelOutpoints
    },
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
  return {
    ...step,
    payloadBytes: Buffer.byteLength(step.payload, 'utf8'),
    payloadHex: asciiHex(step.payload),
    txid,
    feeBtc,
    explorer: `https://mempool.space/testnet4/tx/${txid}`,
    fuelInput: outpoint
  };
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const context = {
    routerAddress: config.adminAddress,
    dlcAddress: getNewAddress(config, 'cross-domain-dlc-template'),
    counterpartyAddress: getNewAddress(config, 'cross-domain-counterparty'),
    pledgeTapAnchorAddress: getNewTaprootAddress(config, 'cross-domain-pledge-tap-anchor'),
    tapAssetAnchorAddress: getNewTaprootAddress(config, 'cross-domain-tap-asset-anchor')
  };
  const steps = buildDemoPlan(context);
  validatePlan(steps);

  const result = {
    kind: 'bitcoin_testnet_cross_domain_liquidity_demo',
    network: 'BTCTEST',
    bitcoinNetwork: 'testnet4',
    adminAddress: config.adminAddress,
    context,
    startedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    steps: []
  };

  if (config.dryRun) {
    result.steps = steps.map((step) => ({
      ...step,
      payloadBytes: Buffer.byteLength(step.payload, 'utf8'),
      payloadHex: asciiHex(step.payload),
      explorer: null,
      txid: null,
      outputs: step.proofKind ? [] : buildOutputs(step)
    }));
  } else {
    const onchainTail = steps.slice(1).filter((step) => !step.proofKind);
    const fanout = broadcastFundedFanout(config, steps[0], onchainTail.length);
    result.steps.push(fanout.sent);
    console.log(JSON.stringify({
      label: fanout.sent.label,
      phase: fanout.sent.phase,
      txid: fanout.sent.txid,
      explorer: fanout.sent.explorer
    }));
    let fuelIndex = 0;
    for (let i = 1; i < steps.length; i += 1) {
      if (steps[i].proofKind) {
        const sent = {
          ...steps[i],
          payloadBytes: Buffer.byteLength(steps[i].payload, 'utf8'),
          payloadHex: asciiHex(steps[i].payload),
          txid: null,
          explorer: null
        };
        result.steps.push(sent);
        console.log(JSON.stringify({
          label: sent.label,
          phase: sent.phase,
          proofKind: sent.proofKind
        }));
        continue;
      }
      const sent = broadcastFuelStep(config, steps[i], fanout.fuelOutpoints[fuelIndex]);
      fuelIndex += 1;
      result.steps.push(sent);
      console.log(JSON.stringify({
        label: sent.label,
        phase: sent.phase,
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
  buildDemoPlan,
  validatePlan
};
