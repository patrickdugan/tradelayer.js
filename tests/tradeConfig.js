/**
 * tradeConfigs.js
 *
 * Deterministic trade setups for contract 3
 * Uses EXISTING sendType18Order exactly as implemented
 */
const TxUtils = require('../src/txUtils.js');
const clientPromise = require('../src/client').getInstance();


const { sendType18Order } = require('./spamspamspam');

const BASE_PRICE = 148;

const TRADERS = {
  A: "tltc1q0s2jlc7lem36am6qavv5847564h8fgwke7c7gr",
  B: "tltc1qvg6q9lyxz5xx328q099g2grh8pynfwwws3l6fq",
  C: "tltc1qngxa8d84at2286c8n9ss04kk3fc2fmnvdvtz5u",
  D: "tltc1qemlplwusg44fnu8hjmn8gwrx5eygm0gz5dn6xa"
};
async function run() {
  console.log('[*] Init TxUtils + client…');
  await TxUtils.init();
  await clientPromise; // force client to exist

  console.log('--- TRADE CONFIGS START ---');

  await sendType18Order(TRADERS.A, 'BUY',  BASE_PRICE, 5);
  await sendType18Order(TRADERS.B, 'SELL', BASE_PRICE, 5);

  await sendType18Order(TRADERS.C, 'BUY',  BASE_PRICE, 20);
  await sendType18Order(TRADERS.D, 'SELL', BASE_PRICE, 20);

  await sendType18Order(TRADERS.B, 'SELL', BASE_PRICE, 40);
  await sendType18Order(TRADERS.A, 'BUY',  BASE_PRICE, 15);
  await sendType18Order(TRADERS.C, 'BUY',  BASE_PRICE, 25);

  console.log('--- TRADE CONFIGS END ---');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
