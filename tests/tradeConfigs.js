/**
 * tests/tradeConfigs.js
 *
 * Deterministic seeding for liquidation scenarios E3–E8 on CONTRACT_ID=3.
 *
 * IMPORTANT: no object-params; everything is positional.
 *
 * Usage:
 *   node tests/tradeConfigs.js E6
 *   node tests/tradeConfigs.js E7
 *   node tests/tradeConfigs.js E8
 */

'use strict';

const TxUtils = require('../src/txUtils.js');
const clientPromise = require('../src/client').getInstance();

const CONTRACT_ID = 3;

// These are your current actors from the margin map snapshot.
const ADDR_SHORT_1 = 'tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq';
const ADDR_SHORT_2 = 'tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa';

const ADDR_LONG_1  = 'tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr';
const ADDR_LONG_2  = 'tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u';

// Pulling a known-funded address from spamspamspam.js tallyMap snippet.
const ADDR_LONG_3  = 'tltc1qp5z2la8sy69np798pc36up5zk2vg0fw2g7pml2';

// Prices
const SEED_PRICE = 75;   // aligns with your avgPrice in the current mMap snapshot

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _inited = false;
async function init() {
  if (_inited) return;

  // Your TxUtils code historically wants init() *and* a client bound somewhere.
  await TxUtils.init();
  const client = await clientPromise;

  // Best-effort patching for whichever field txUtils currently reads.
  if (!TxUtils.client) TxUtils.client = client;
  if (!TxUtils._client) TxUtils._client = client;
  if (!TxUtils.rpc) TxUtils.rpc = client;
  if (typeof TxUtils.setClient === 'function') TxUtils.setClient(client);

  _inited = true;
}

async function sendType18Order(traderAddr, side, priceFloat, contracts) {
  const action = (side === 'BUY') ? 1 : 2;
  const contractParams = {
    contractId: CONTRACT_ID,
    action: action,
    amount: contracts,
    price: priceFloat,
  };

  console.log(`[tx18] ${traderAddr} ${side} ${contracts} @ ${priceFloat}`);
  return TxUtils.createContractOnChainTradeTransaction(traderAddr, contractParams);
}

async function matchedTrade(buyAddr, sellAddr, priceFloat, contracts) {
  // Buy first so it can rest if needed, then sell to cross.
  await sendType18Order(buyAddr, 'BUY', priceFloat, contracts);
  await sleep(800);
  await sendType18Order(sellAddr, 'SELL', priceFloat, contracts);
  await sleep(1200);
}

async function restOrder(buyAddr, side, priceFloat, contracts) {
  // Intentionally non-crossing price so it sits on book.
  await sendType18Order(buyAddr, side, priceFloat, contracts);
  await sleep(1200);
}

// ------------------------------------------------------------
// E3: Partial liquidation seed
// (This just ensures a “liq candidate” exists; liquidation is done by oracle script.)
// ------------------------------------------------------------
async function seedE3() {
  console.log('\n[E3] Seed a thin-ish long that should liquidate on a small dip below liqPrice');
  // Long2 vs Short2 (add exposure on both sides)
  await matchedTrade(ADDR_LONG_2, ADDR_SHORT_2, SEED_PRICE, 5);
}

// ------------------------------------------------------------
// E4: Full liquidation seed
// ------------------------------------------------------------
async function seedE4() {
  console.log('\n[E4] Seed a bigger long so a deep oracle move can force full liquidation');
  await matchedTrade(ADDR_LONG_1, ADDR_SHORT_1, SEED_PRICE, 10);
}

// ------------------------------------------------------------
// E6: Multi-user liquidation seed (3 longs)
// ------------------------------------------------------------
async function seedE6() {
  console.log('\n[E6] Ensure 3 distinct longs exist so one oracle print can liq all 3');
  // Add a third long against a short (pick short_1, since it already holds short exposure)
  await matchedTrade(ADDR_LONG_3, ADDR_SHORT_1, SEED_PRICE, 5);
}

// ------------------------------------------------------------
// E7: Liquidation while orders resting
// ------------------------------------------------------------
async function seedE7() {
  console.log('\n[E7] Place resting orders for the trader we plan to liquidate, then liq via oracle');
  // Give LONG_2 a resting BUY far below market (should not match at ~155)
  await restOrder(ADDR_LONG_2, 'BUY', 90, 3);
  // Also add a resting SELL far above market (also should not match)
  await restOrder(ADDR_LONG_2, 'SELL', 220, 2);
}

// ------------------------------------------------------------
// E8: Liquidation while flipping
// ------------------------------------------------------------
async function seedE8() {
  console.log('\n[E8] Flip LONG_2 (long -> short), then you immediately oracle-cross for short liq');

  // Step 1: Ensure LONG_2 has a small long
  await matchedTrade(ADDR_LONG_2, ADDR_SHORT_2, SEED_PRICE, 5);

  // Step 2: Flip it by selling more than it holds, crossed by a buyer (LONG_1)
  // If LONG_2 had +5, selling 8 should end at -3.
  await matchedTrade(ADDR_LONG_1, ADDR_LONG_2, SEED_PRICE, 8);
}

async function main() {
  await init();

  const which = String(process.argv[2] || '').toUpperCase();

  console.log('--- TRADE CONFIG SEED START ---');
  console.log(`contractId=${CONTRACT_ID} seedPrice=${SEED_PRICE}`);

  if (which === 'E3') return seedE3();
  if (which === 'E4') return seedE4();
  if (which === 'E6') return seedE6();
  if (which === 'E7') return seedE7();
  if (which === 'E8') return seedE8();

  console.log('Pick one: E3 | E4 | E6 | E7 | E8');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
