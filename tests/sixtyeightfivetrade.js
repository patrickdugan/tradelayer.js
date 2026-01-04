/**
 * trade68_5.js
 *
 * Purpose:
 * Execute controlled crosses at 68.5 without self-trade nullification.
 *
 * Sequence:
 *  1) vg6q sells 5 @ 68.5
 *  2) 0s2j buys 5 @ 68.5
 *  3) 8gvn sells 5 @ 68.5
 *  4) 0s2j buys 5 @ 68.5
 */

'use strict';

const TxUtils = require('../src/txUtils.js');
const clientPromise = require('../src/client').getInstance();

const CONTRACT_ID = 3;
const PRICE = 68.5;
const SIZE = 5;

// Addresses
const ADDR_VG6Q = 'tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq';
const ADDR_0S2J = 'tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr';
const ADDR_8GVN = 'tltc1q8gvnl4z8tmjtl8hggyqdt59h3n0cg873zjqwp6';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let _inited = false;
async function init() {
  if (_inited) return;
  await TxUtils.init();
  const client = await clientPromise;
  TxUtils.client = client;
  TxUtils._client = client;
  TxUtils.rpc = client;
  if (typeof TxUtils.setClient === 'function') {
    TxUtils.setClient(client);
  }
  _inited = true;
}

async function sendOrder(addr, side, price, amount) {
  const action = side === 'BUY' ? 1 : 2;
  console.log(`[tx18] ${addr.slice(-6)} ${side} ${amount} @ ${price}`);
  return TxUtils.createContractOnChainTradeTransaction(addr, {
    contractId: CONTRACT_ID,
    action,
    amount,
    price
  });
}

async function main() {
  await init();

  console.log('\n=== Controlled cross @ 68.5 ===');

  // 1) vg6q sells 5 @ 68.5
  await sendOrder(ADDR_VG6Q, 'SELL', PRICE, SIZE);
  await sleep(800);

  // 2) 0s2j buys 5 @ 68.5
  await sendOrder(ADDR_0S2J, 'BUY', PRICE, SIZE);
  await sleep(1500);

  // 3) 8gvn sells 5 @ 68.5
  await sendOrder(ADDR_8GVN, 'SELL', PRICE, SIZE);
  await sleep(800);

  // 4) 0s2j buys 5 @ 68.5
  await sendOrder(ADDR_0S2J, 'BUY', PRICE, SIZE);
  await sleep(1500);

  console.log('=== Done ===');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
