/**
 * tests/tradeConfigs.js - IOU Proration Test E12
 * 
 * Current state:
 *   8gvn: +35 long  @ 67.74
 *   vg6q: -23 short @ 66.81
 *   0s2j: -12 short @ 66.58
 *   Mark: 60
 * 
 * Test: Trade at 67 (in the spread between best bid 65 and best ask 69.47)
 * This won't cross resting orders.
 */

'use strict';

const TxUtils = require('../src/txUtils.js');
const clientPromise = require('../src/client').getInstance();

const CONTRACT_ID = 3;

// Current positions
const ADDR_LONG  = 'tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6';  // +35 @ 67.74
const ADDR_SHORT_1 = 'tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq';  // -23 @ 66.81
const ADDR_SHORT_2 = 'tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr';  // -12 @ 66.58

// Trade price in the spread (65-69.47) so it won't hit resting orders
const TRADE_PRICE = 67;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _inited = false;
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
  await sleep(1500);
}

// ------------------------------------------------------------
// E12: IOU Proration - Multilateral Closing Trades
// 
// Trade 1: SHORT_1 (vg6q) closes 10 by buying from LONG (8gvn) selling 10
//   - vg6q: short from 66.81, closes at 67 -> loss = (67-66.81)*10 = 1.9
//   - 8gvn: long from 67.74, closes at 67 -> loss = (67-67.74)*10 = -7.4
//   - Net delta: -1.9 + (-7.4) = -9.3 (negative, no IOU from this trade)
//
// Trade 2: SHORT_2 (0s2j) closes 10 by buying from LONG (8gvn) selling 10  
//   - 0s2j: short from 66.58, closes at 67 -> loss = (67-66.58)*10 = 4.2
//   - 8gvn: long from 67.74, closes at 67 -> loss = (67-67.74)*10 = -7.4
//   - Net delta: -4.2 + (-7.4) = -11.6 (negative, no IOU)
//
// Hmm both deltas negative because mark moved against the long...
// Need to trade at a price where someone profits.
//
// Let's try at 68 instead:
// Trade 1: vg6q closes short at 68
//   - vg6q: (68-66.81)*10 = -11.9 loss
//   - 8gvn: (68-67.74)*10 = +2.6 profit  
//   - Delta: +2.6 - 11.9 = -9.3 still negative
//
// The issue is settlement PNL is vs LAST MARK (60), not vs avg entry!
// So at trade price 67:
//   - Seller (8gvn long closing): settles vs mark 60, gains (67-60)*10 = +70
//   - Buyer (vg6q short closing): settles vs mark 60, loses (60-67)*10 = -70
//   - Delta = 0 (perfectly offset)
//
// For IOU to trigger we need asymmetric settlement...
// ------------------------------------------------------------

async function seedE12() {
  console.log('\n[E12] IOU Proration Test - Trades at 67');
  console.log('Current positions:');
  console.log('  8gvn: +35 long  @ 67.74 (mark 60)');
  console.log('  vg6q: -23 short @ 66.81 (mark 60)');
  console.log('  0s2j: -12 short @ 66.58 (mark 60)');
  
  console.log('\n--- Trade 1: vg6q buys 10, 8gvn sells 10 @ 67 ---');
  console.log('Settlement PNL (vs mark 60):');
  console.log('  8gvn sells (closes long): (67-60)*10 = +70');
  console.log('  vg6q buys (closes short): (60-67)*10 = -70');
  console.log('  Delta: 0 (no IOU expected)');
  
  await matchedTrade(ADDR_SHORT_1, ADDR_LONG, TRADE_PRICE, 10);
  
  console.log('\n--- Trade 2: 0s2j buys 5, 8gvn sells 5 @ 67 ---');
  await matchedTrade(ADDR_SHORT_2, ADDR_LONG, TRADE_PRICE, 5);
  
  console.log('\n--- Trade 3: 0s2j buys 5, vg6q sells 5 @ 67 ---');
  console.log('Wait - vg6q is SHORT, selling would ADD to short, not close');
  console.log('Skipping this - need vg6q to BUY to close');
  
  console.log('\n[E12] Done. Check IOU bucket and individual claims.');
}

// E13: Force positive delta by having same-side close
// If two shorts close against each other... wait that doesn't work
// 
// Actually the way to get positive delta is when settlement PNL 
// is asymmetric due to different lastMark values or same-block opens

async function seedE13() {
  console.log('\n[E13] IOU Test - Asymmetric Settlement');
  console.log('First move oracle to 67, then run trades');
  
  // After oracle at 67:
  // 8gvn long +35: unrealized = (67-67.74)*35 = -25.9 (underwater)
  // vg6q short -23: unrealized = (66.81-67)*23 = -4.37 (underwater)  
  // 0s2j short -12: unrealized = (66.58-67)*12 = -5.04 (underwater)
  
  // Trade at 68:
  // 8gvn sells 10 (closes): settlement vs mark 67 = (68-67)*10 = +10
  // vg6q buys 10 (closes): settlement vs mark 67 = (67-68)*10 = -10
  // Delta = 0 still...
  
  // The only way to get non-zero delta is:
  // 1. Same-block open/close (uses trade price not mark for partial)
  // 2. One side opened this block (no prior mark)
  // 3. Liquidation mechanics
  
  console.log('To generate IOU delta, we need same-block scenarios');
  console.log('or different effective marks per trader.');
}

async function seedE14() {
  console.log('\n[E14] Asymmetric PNL closes');
  
  // Trade 1: 8gvn sells (close long), vg6q buys (close short) @ 67
  console.log('Trade 1: 8gvn sells 10, vg6q buys 10 @ 67');
  console.log('  8gvn PNL: (67 - 67.74) * 10 = -7.4');
  console.log('  vg6q PNL: (66.81 - 67) * 10 = -1.9');
  
  await sendType18Order(ADDR_LONG, 'SELL', 67, 10);      // 8gvn sells
  await sleep(800);
  await sendType18Order(ADDR_SHORT_1, 'BUY', 67, 10);    // vg6q buys to close
  await sleep(1500);
  
  // Trade 2: 8gvn sells (close long), 0s2j buys (close short) @ 68
  console.log('Trade 2: 8gvn sells 5, 0s2j buys 5 @ 68');
  console.log('  8gvn PNL: (68 - 67.74) * 5 = +1.3');
  console.log('  0s2j PNL: (66.58 - 68) * 5 = -7.1');
  
  await sendType18Order(ADDR_LONG, 'SELL', 68, 5);       // 8gvn sells
  await sleep(800);
  await sendType18Order(ADDR_SHORT_2, 'BUY', 68, 5);     // 0s2j buys to close
  await sleep(1500);
  
  console.log('\nCheck IOU bucket - settlement PNL will differ from accounting PNL');
}

async function main() {
  await init();
  const which = String(process.argv[2] || '').toUpperCase();
  
  console.log('=== TRADE CONFIG ===');
  console.log(`contractId=${CONTRACT_ID}`);

  switch(which) {
    case 'E12': return seedE12();
    case 'E13': return seedE13();
    case 'E14': return seedE14()
    default:
      console.log('Options: E12 | E13');
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});