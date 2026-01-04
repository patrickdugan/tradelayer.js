/**
 * cancel_then_sell_68_5.js
 *
 * 1) Cancel existing BID by txid
 * 2) Place SELL order
 */

'use strict';

const TxUtils = require('../src/txUtils.js');
const clientPromise = require('../src/client').getInstance();

const CONTRACT_ID = 3;
const PRICE = 68.6;
const SIZE = 5;

// Address with the resting bid
const ADDR_8GVN = 'tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq';

// Order txid to cancel
const BID_TXID =
  '86d1520536b05771904095e22e2744e86fd6f986a558f070f4488c0f01d0d821';

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

async function cancelOrder(addr, txid) {
  console.log(`[tx cancel] ${addr.slice(-6)} cancel ${txid.slice(0, 8)}…`);
  return TxUtils.createCancelTransaction(addr, txid);
}

async function sell(addr, price, amount) {
  console.log(`[tx18] ${addr.slice(-6)} SELL ${amount} @ ${price}`);
  return TxUtils.createContractOnChainTradeTransaction(addr, {
    contractId: CONTRACT_ID,
    sell: '0', // SELL
    amount,
    price
  });
}

async function main() {
  await init();

  console.log('\n=== Cancel bid then sell @ 68.5 ===');

  // 1) Cancel the blocking bid
  //await cancelOrder(ADDR_8GVN, BID_TXID);
  await sleep(1200);

  // 2) Place the sell
  await sell(ADDR_8GVN, PRICE, SIZE);
  await sleep(1500);

  console.log('=== Done ===');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
