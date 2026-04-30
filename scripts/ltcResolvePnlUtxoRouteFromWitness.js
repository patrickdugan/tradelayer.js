const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');

process.env.RPC_WALLET = process.env.RPC_WALLET || process.env.WALLET_NAME || 'tl-wallet';

const TxUtils = require('../src/txUtils.js');
const { PnlRouteRegistry } = require('../src/pnlRouteRegistry.js');

const COIN = 100000000;
const NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'tltc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0x3a,
  wif: 0xef
};

const REVEAL_ARTIFACT = path.join(__dirname, '..', 'artifacts', 'ltc-pnl-witness-reveal-latest.json');
const DLC_ARTIFACT = path.join(__dirname, '..', 'artifacts', 'ltc-second-funder-dlc-perp-tlusd-latest.json');
const OUT = path.join(__dirname, '..', 'artifacts', 'ltc-pnl-utxo-route-plan-latest.json');
const BROADCAST = process.env.TL_BROADCAST_DLC_PAYOUT === '1';

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

function parseEnvelopeFromWitnessScript(scriptHex) {
  const chunks = bitcoin.script.decompile(Buffer.from(scriptHex, 'hex')) || [];
  const buffers = chunks.filter(Buffer.isBuffer);
  if (!buffers.length || buffers[0].toString('utf8') !== 'TLPNLROUTE:1') {
    throw new Error('Reveal witness is not a TLPNLROUTE envelope');
  }
  const json = Buffer.concat(buffers.slice(1)).toString('utf8');
  const envelope = JSON.parse(json);
  if (envelope.envelope !== 'TLPNLROUTE') {
    throw new Error('Invalid TLPNLROUTE envelope marker');
  }
  const actualHash = sha256Hex(envelope.payload);
  if (actualHash !== String(envelope.payloadHash || '').toLowerCase()) {
    throw new Error(`Payload hash mismatch: ${actualHash} !== ${envelope.payloadHash}`);
  }
  return envelope;
}

function normalizePayoutPlan(rawPayouts, outputSats) {
  const dustSats = Number(process.env.TL_DLC_DUST_SATS || 546);
  const payouts = (rawPayouts || [])
    .map((entry) => ({
      address: entry.address || entry.toAddress || entry.recipientAddress,
      sats: Number(entry.sats ?? entry.amountSats ?? entry.valueSats ?? 0),
      weight: Number(entry.weight ?? entry.tokenAmount ?? entry.amount ?? 0)
    }))
    .filter((entry) => entry.address);
  if (!payouts.length) throw new Error('PNL reveal has no UTXO payout recipients');

  const explicitSats = payouts.reduce((sum, entry) => sum + (Number.isFinite(entry.sats) ? entry.sats : 0), 0);
  if (explicitSats > 0) {
    if (explicitSats !== outputSats) {
      throw new Error(`Explicit payout sats ${explicitSats} do not match available DLC sats ${outputSats}`);
    }
    return payouts.map((entry) => {
      if (entry.sats < dustSats) throw new Error(`Payout for ${entry.address} is below dust`);
      return { address: entry.address, sats: entry.sats, amount: ltc(entry.sats) };
    });
  }

  const totalWeight = payouts.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error('Payout vector must include positive weights or explicit sats');
  }

  let allocated = 0;
  return payouts.map((entry, index) => {
    const satsOut = index === payouts.length - 1
      ? outputSats - allocated
      : Math.floor((outputSats * entry.weight) / totalWeight);
    allocated += satsOut;
    if (satsOut < dustSats) throw new Error(`Payout for ${entry.address} is below dust`);
    return { address: entry.address, sats: satsOut, amount: ltc(satsOut) };
  });
}

async function spendDlcToPlan(client, dlc, outputPlan, input, inputValue) {
  const outputs = outputPlan.map((entry) => ({ [entry.address]: entry.amount }));
  const raw = await client.rpcCall('createrawtransaction', [
    [{ txid: input.txid, vout: input.vout }],
    outputs
  ], false);
  const prevtxs = [{
    txid: input.txid,
    vout: input.vout,
    scriptPubKey: input.scriptPubKey,
    witnessScript: dlc.dlc.witnessScript,
    amount: inputValue
  }];
  let signed = await client.rpcCall('signrawtransactionwithwallet', [raw, prevtxs], true);
  if (!signed.complete) {
    const keys = [
      await client.rpcCall('dumpprivkey', [dlc.dlc.partyA], true),
      await client.rpcCall('dumpprivkey', [dlc.dlc.partyB], true)
    ];
    signed = await client.rpcCall('signrawtransactionwithkey', [raw, keys, prevtxs], true);
  }
  const decoded = await client.decoderawtransaction(signed.hex);
  const accept = signed.complete ? await client.rpcCall('testmempoolaccept', [[signed.hex]], false) : null;
  const txid = BROADCAST && signed.complete ? await client.sendrawtransaction(signed.hex) : decoded.txid;
  return { txid, signed, decoded, mempoolAccept: accept, broadcast: BROADCAST && signed.complete };
}

async function main() {
  await TxUtils.init();
  const client = TxUtils.client;
  const revealArtifact = JSON.parse(fs.readFileSync(process.env.TL_PNL_REVEAL_ARTIFACT || REVEAL_ARTIFACT, 'utf8'));
  const dlc = JSON.parse(fs.readFileSync(process.env.TL_DLC_ARTIFACT || DLC_ARTIFACT, 'utf8'));
  const revealTxid = process.env.TL_PNL_REVEAL_TXID || revealArtifact.reveal.txid;
  const revealTx = await client.getRawTransaction(revealTxid);
  const witness = revealTx?.vin?.[0]?.txinwitness || [];
  const witnessScriptHex = witness[witness.length - 1];
  if (!witnessScriptHex) throw new Error(`No witness script found in reveal tx ${revealTxid}`);
  const envelope = parseEnvelopeFromWitnessScript(witnessScriptHex);
  const registeredRoute = await PnlRouteRegistry.recordEnvelope(envelope, {
    revealTxid,
    commitTxid: revealArtifact.commit?.txid || '',
    block: envelope.payload?.block || 0,
    challengeBlocks: process.env.TL_PNL_ROUTE_CHALLENGE_BLOCKS
  });
  if (registeredRoute.status === 'CHALLENGED') {
    throw new Error(`PNL route is challenged: ${registeredRoute.payloadHash}`);
  }
  const grantTx = await client.getRawTransaction(dlc.grant.txid);
  const voutIndex = Number(dlc.grant.referenceOutputs[0].vout);
  const grantVout = grantTx.vout.find((o) => Number(o.n) === voutIndex);
  if (!grantVout) throw new Error(`DLC grant output ${voutIndex} not found`);

  const inputSats = sats(grantVout.value);
  const feeSats = Number(process.env.TL_DLC_SPEND_FEE_SATS || 2000);
  const outputSats = inputSats - feeSats;
  if (outputSats <= 0) throw new Error('DLC output is too small after fee');

  const outputPlan = normalizePayoutPlan(envelope.payload.utxoPayouts, outputSats);
  const planHash = sha256Hex({
    revealTxid,
    payloadHash: envelope.payloadHash,
    dlcRef: envelope.payload.dlcRef,
    grantTxid: dlc.grant.txid,
    grantVout: voutIndex,
    outputPlan
  });

  let dlcSpend = null;
  if (process.env.TL_BUILD_DLC_SPEND === '1' || BROADCAST) {
    dlcSpend = await spendDlcToPlan(client, dlc, outputPlan, {
      txid: dlc.grant.txid,
      vout: voutIndex,
      scriptPubKey: grantVout.scriptPubKey.hex
    }, Number(grantVout.value));
  }

  const summary = {
    run: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    revealTxid,
    payloadHash: envelope.payloadHash,
    planHash,
    dlcInput: {
      txid: dlc.grant.txid,
      vout: voutIndex,
      address: dlc.dlc.address,
      amount: Number(grantVout.value),
      sats: inputSats
    },
    feeSats,
    outputPlan,
    envelope: {
      protocol: envelope.payload.protocol,
      version: envelope.payload.version,
      source: envelope.payload.source,
      dlcRef: envelope.payload.dlcRef,
      propertyId: envelope.payload.propertyId,
      tokenPnl: envelope.payload.tokenPnl,
      attestation: envelope.attestation
    },
    registry: {
      status: registeredRoute.status,
      routeHash: registeredRoute.routeHash,
      payoutVectorHash: registeredRoute.payoutVectorHash,
      tokenPnlHash: registeredRoute.tokenPnlHash,
      challengeDeadlineBlock: registeredRoute.challengeDeadlineBlock
    },
    dlcSpend
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ artifactPath: OUT, summary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
