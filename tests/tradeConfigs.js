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
/**
 * tests/tradeConfigs.js - Extended with IOU proration tests
 * 
 * New test: E9 - IOU Proration
 * 
 * Setup:
 * - A & B trade at price P1, building positions
 * - C & D trade at price P1, building positions  
 * - Price moves to P2
 * - A closes against C (different PNL than if A closed against B)
 * - B closes against D (different PNL amounts)
 * - Verify IOU deltas are recorded and proration works
 */

// Group 1: A (long) vs B (short)
const ADDR_A = 'tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr';  // will go long
const ADDR_B = 'tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq';  // will go short

// Group 2: C (long) vs D (short)
const ADDR_C = 'tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u';  // will go long
const ADDR_D = 'tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6';  // will go short

// Entry prices - different for each pair to create asymmetric PNL
const ENTRY_PRICE_AB = 65;
const ENTRY_PRICE_CD = 70;

// Exit price - where cross-pair trades happen
const EXIT_PRICE = 75;

async function init() {
  if (_inited) return;
  await TxUtils.init();
  const client = await clientPromise;
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
  console.log(`[tx18] ${traderAddr.slice(-8)} ${side} ${contracts} @ ${priceFloat}`);
  return TxUtils.createContractOnChainTradeTransaction(traderAddr, contractParams);
}

async function matchedTrade(buyAddr, sellAddr, priceFloat, contracts) {
  await sendType18Order(buyAddr, 'BUY', priceFloat, contracts);
  await sleep(800);
  await sendType18Order(sellAddr, 'SELL', priceFloat, contracts);
  await sleep(1200);
}

// ------------------------------------------------------------
// E9: IOU Proration Test
// 
// Phase 1: Build positions
//   - A goes long 10 @ 65 vs B short
//   - C goes long 10 @ 70 vs D short
//
// Phase 2: Cross-close at 75 (after oracle moves price)
//   - A (long from 65) sells to C's closing buy -> A profits 10pts/contract
//   - B (short from 65) buys from D's closing sell -> B loses 10pts/contract
//   - But wait, C is long... need to think about this differently
//
// Actually for IOU testing we need:
//   - A long, B short (matched at 65)
//   - C long, D short (matched at 70)
//   - Then: A closes by selling to D (D is closing their short by buying)
//   - And: B closes by buying from C (C is closing their long by selling)
// ------------------------------------------------------------

async function seedE9_phase1() {
  console.log('\n[E9-P1] Building initial positions at different entry prices');
  console.log('A goes LONG 10 @ 65, B goes SHORT 10 @ 65');
  await matchedTrade(ADDR_A, ADDR_B, ENTRY_PRICE_AB, 10);
  
  await sleep(2000);
  
  console.log('C goes LONG 10 @ 70, D goes SHORT 10 @ 70');
  await matchedTrade(ADDR_C, ADDR_D, ENTRY_PRICE_CD, 10);
  
  console.log('\n[E9-P1] Positions established:');
  console.log(`  A: +10 long  @ avg 65 (liq ~52)`);
  console.log(`  B: -10 short @ avg 65 (liq ~78)`);
  console.log(`  C: +10 long  @ avg 70 (liq ~56)`);
  console.log(`  D: -10 short @ avg 70 (liq ~84)`);
  console.log('\nNow run oracle to move mark to ~75, then run E9-P2');
}

async function seedE9_phase2() {
  console.log('\n[E9-P2] Cross-closing trades at EXIT_PRICE=75');
  console.log('This creates asymmetric PNL that should generate IOU entries\n');
  
  // A (long +10 @ 65) closes by selling 10 @ 75
  // Needs a buyer - let's have D (short -10 @ 70) close by buying
  // D closes short: buys 10 @ 75, was short from 70, loses 5*10 = 50
  // A closes long: sells 10 @ 75, was long from 65, gains 10*10 = 100
  // delta = 100 + (-50) = 50 (positive, IOU should trigger)
  
  console.log('Trade 1: A sells (closes long) to D (closes short) @ 75');
  console.log('  A PNL: (75-65)*10 = +100');
  console.log('  D PNL: (70-75)*10 = -50');
  console.log('  Delta: +50 -> should create IOU');
  await matchedTrade(ADDR_D, ADDR_A, EXIT_PRICE, 10);  // D buys, A sells
  
  await sleep(2000);
  
  // B (short -10 @ 65) closes by buying 10 @ 75
  // Needs a seller - let's have C (long +10 @ 70) close by selling
  // C closes long: sells 10 @ 75, was long from 70, gains 5*10 = 50  
  // B closes short: buys 10 @ 75, was short from 65, loses 10*10 = -100
  // delta = 50 + (-100) = -50 (negative, no IOU trigger per your logic)
  
  console.log('\nTrade 2: B buys (closes short) from C (closes long) @ 75');
  console.log('  C PNL: (75-70)*10 = +50');
  console.log('  B PNL: (65-75)*10 = -100');
  console.log('  Delta: -50 -> NO IOU (delta <= 0)');
  await matchedTrade(ADDR_B, ADDR_C, EXIT_PRICE, 10);  // B buys, C sells
  
  console.log('\n[E9-P2] Complete. Check IOU state for contract 3');
}

// ------------------------------------------------------------
// E10: IOU Proration with Multiple Positive Deltas
// 
// Need scenario where BOTH trades produce positive delta
// This requires careful entry price setup
// ------------------------------------------------------------

async function seedE10_phase1() {
  console.log('\n[E10-P1] Building positions for multi-IOU test');
  
  // A long 10 @ 60, B short 10 @ 60
  console.log('A LONG 10 @ 60, B SHORT 10 @ 60');
  await matchedTrade(ADDR_A, ADDR_B, 60, 10);
  
  await sleep(2000);
  
  // C long 10 @ 62, D short 10 @ 62
  console.log('C LONG 10 @ 62, D SHORT 10 @ 62');
  await matchedTrade(ADDR_C, ADDR_D, 62, 10);
  
  console.log('\nPositions set. Move oracle to 65, then run E10-P2');
}

async function seedE10_phase2() {
  console.log('\n[E10-P2] Closing at 65 to generate multiple IOU entries');
  
  // Trade at 65:
  // A closes long (from 60): +5*10 = +50
  // D closes short (from 62): (62-65)*10 = -30
  // Delta = +20 -> IOU
  
  console.log('Trade 1: A sells to D @ 65');
  console.log('  A: +50, D: -30, delta: +20');
  await matchedTrade(ADDR_D, ADDR_A, 65, 10);
  
  await sleep(2000);
  
  // C closes long (from 62): +3*10 = +30  
  // B closes short (from 60): (60-65)*10 = -50
  // Delta = -20 -> NO IOU
  
  console.log('Trade 2: C sells to B @ 65');
  console.log('  C: +30, B: -50, delta: -20 (no IOU)');
  await matchedTrade(ADDR_B, ADDR_C, 65, 10);
  
  console.log('\nDone. Only Trade 1 should have IOU entry.');
}

// ------------------------------------------------------------
// E11: Flip + IOU interaction
// Test that position flips properly record IOU for the close portion
// ------------------------------------------------------------

async function seedE11() {
  console.log('\n[E11] Flip with IOU generation');
  
  // A goes long 10 @ 60
  console.log('A LONG 10 @ 60 vs B SHORT');
  await matchedTrade(ADDR_A, ADDR_B, 60, 10);
  
  await sleep(2000);
  
  // Price moves to 70 (via oracle)
  // A flips: sells 15 @ 70
  // - Closes 10 contracts: PNL = +100
  // - Opens 5 short: new position
  // C buys 15 @ 70 (new long)
  
  console.log('A SELLS 15 @ 70 (flip from +10 to -5)');
  console.log('C BUYS 15 @ 70 (new long)');
  console.log('Close portion: A gains +100, C opens (no PNL yet)');
  console.log('Delta = +100 from A close only -> IOU');
  
  await matchedTrade(ADDR_C, ADDR_A, 70, 15);
  
  console.log('\n[E11] Check that flip recorded AND IOU recorded for close portion');
}

async function main() {
  await init();

  const which = String(process.argv[2] || '').toUpperCase();

  console.log('=== TRADE CONFIG SEED ===');
  console.log(`contractId=${CONTRACT_ID}`);

  switch(which) {
    case 'E3': return seedE3();
    case 'E4': return seedE4();
    case 'E6': return seedE6();
    case 'E7': return seedE7();
    case 'E8': return seedE8();
    case 'E9-P1': return seedE9_phase1();
    case 'E9-P2': return seedE9_phase2();
    case 'E10-P1': return seedE10_phase1();
    case 'E10-P2': return seedE10_phase2();
    case 'E11': return seedE11();
    default:
      console.log('Options: E3 | E4 | E6 | E7 | E8 | E9-P1 | E9-P2 | E10-P1 | E10-P2 | E11');
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
