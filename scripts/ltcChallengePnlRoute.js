const fs = require('fs');
const path = require('path');

process.env.RPC_WALLET = process.env.RPC_WALLET || process.env.WALLET_NAME || 'tl-wallet';

const TxUtils = require('../src/txUtils.js');
const { PnlRouteRegistry } = require('../src/pnlRouteRegistry.js');

const ROUTE_ARTIFACT = path.join(__dirname, '..', 'artifacts', 'ltc-pnl-utxo-route-plan-latest.json');
const OUT = path.join(__dirname, '..', 'artifacts', 'ltc-pnl-route-challenge-latest.json');

async function main() {
  await TxUtils.init();
  const artifact = JSON.parse(fs.readFileSync(process.env.TL_PNL_ROUTE_PLAN_ARTIFACT || ROUTE_ARTIFACT, 'utf8'));
  const block = await TxUtils.client.getBlockCount();
  const payloadHash = process.env.TL_PNL_PAYLOAD_HASH || artifact.payloadHash;
  const evidence = {
    expectedDlcRef: process.env.TL_EXPECTED_DLC_REF || artifact.envelope?.dlcRef,
    expectedPropertyId: process.env.TL_EXPECTED_PROPERTY_ID || artifact.envelope?.propertyId,
    expectedPayoutVectorHash: process.env.TL_EXPECTED_PAYOUT_VECTOR_HASH || '',
    expectedTokenPnlHash: process.env.TL_EXPECTED_TOKEN_PNL_HASH || '',
    expectedPayloadHash: process.env.TL_EXPECTED_PAYLOAD_HASH || ''
  };
  Object.keys(evidence).forEach((key) => {
    if (evidence[key] === '' || evidence[key] === undefined || evidence[key] === null) delete evidence[key];
  });
  if (!Object.keys(evidence).length && !process.env.TL_CHALLENGE_REASON) {
    throw new Error('Set contradictory TL_EXPECTED_* evidence or TL_CHALLENGE_REASON');
  }
  const doc = await PnlRouteRegistry.challenge(payloadHash, {
    challengerAddress: process.env.TL_CHALLENGER_ADDRESS || '',
    reason: process.env.TL_CHALLENGE_REASON || '',
    evidence,
    block
  });
  const summary = {
    payloadHash,
    status: doc.status,
    challenged: doc.challenged,
    routeHash: doc.routeHash,
    payoutVectorHash: doc.payoutVectorHash,
    tokenPnlHash: doc.tokenPnlHash
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ artifactPath: OUT, summary }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
