/**
 * Live integration harness for options tx type 27.
 *
 * Required env vars:
 * - TL_ADMIN_ADDRESS: admin address that can activate tx types
 * - TL_CHANNEL_ADDRESS: channel address used as sender for type 27 trades
 * - TL_OPTION_TICKER: full option ticker, ex: "3-500000-C-200"
 *
 * Optional env vars:
 * - TL_OPTION_PRICE (default: 1.5)
 * - TL_OPTION_AMOUNT (default: 1)
 * - TL_OPTION_EXPIRY_BLOCK (default: currentBlock + 20)
 * - TL_DRY_RUN=true  (default false)
 */

const TxUtils = require('../src/txUtils');
const Clearing = require('../src/clearing');

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env ${name}=${raw}`);
  return n;
}

async function main() {
  const dryRun = String(process.env.TL_DRY_RUN || 'false').toLowerCase() === 'true';
  const adminAddress = process.env.TL_ADMIN_ADDRESS;
  const channelAddress = process.env.TL_CHANNEL_ADDRESS;
  const ticker = process.env.TL_OPTION_TICKER;

  if (!adminAddress || !channelAddress || !ticker) {
    throw new Error('Missing TL_ADMIN_ADDRESS, TL_CHANNEL_ADDRESS, or TL_OPTION_TICKER');
  }

  await TxUtils.init();
  const block = await TxUtils.getBlockCount();
  const expiryBlock = envNumber('TL_OPTION_EXPIRY_BLOCK', block + 20);

  const optionParams = {
    contractId: ticker,
    price: envNumber('TL_OPTION_PRICE', 1.5),
    amount: envNumber('TL_OPTION_AMOUNT', 1),
    columnAIsSeller: true,
    expiryBlock,
    columnAIsMaker: true
  };

  console.log('[options-live] current block:', block);
  console.log('[options-live] activation tx type: 27');
  console.log('[options-live] option params:', optionParams);
  console.log('[options-live] dry run:', dryRun);

  if (dryRun) return;

  // 1) Activate tx type 27
  const activationTxid = await TxUtils.activationTransaction(adminAddress, 27);
  console.log('[options-live] activation txid:', activationTxid);

  // 2) Stage option trade
  const optionTxid = await TxUtils.createOptionTradeTransaction(channelAddress, optionParams);
  console.log('[options-live] option txid:', optionTxid);

  // 3) Trigger clearing once for basic integration sanity
  const blockAfter = await TxUtils.getBlockCount();
  await Clearing.clearingFunction(blockAfter, true);
  console.log('[options-live] clearing completed at block:', blockAfter);
}

main().catch((err) => {
  console.error('[options-live] failed:', err.message || err);
  process.exit(1);
});
