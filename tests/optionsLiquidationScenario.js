/**
 * Live scenario calculator for options liquidation thresholds.
 *
 * Usage:
 *   WALLET_NAME=wallet.dat TL_SERIES_ID=3 TL_ADDRESS=<addr> TL_SPOT=108 node tests/optionsLiquidationScenario.js
 *
 * Optional:
 *   TL_BLOCK=<height> (defaults to current chain height)
 *   TL_BLOCKS_PER_DAY=144
 */

const TxUtils = require('../src/txUtils');
const Clearing = require('../src/clearing');
const Tally = require('../src/tally');

function asNum(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env ${name}=${raw}`);
  return n;
}

async function main() {
  const seriesId = process.env.TL_SERIES_ID;
  const address = process.env.TL_ADDRESS;
  const spot = asNum('TL_SPOT', null);
  const bpd = asNum('TL_BLOCKS_PER_DAY', 144);

  if (!seriesId || !address || spot === null) {
    throw new Error('Missing TL_SERIES_ID, TL_ADDRESS, or TL_SPOT');
  }

  await TxUtils.init();
  const block = asNum('TL_BLOCK', await TxUtils.getBlockCount());

  const clearing = new Clearing();
  const optionAdj = await clearing.computeOptionAdjustments(
    seriesId,
    address,
    spot,
    block,
    bpd
  );

  const contractInfo = await require('../src/contractRegistry').getContractInfo(Number(seriesId));
  const collateralId = Number(contractInfo?.collateralPropertyId);
  const tally = await Tally.getTally(address, collateralId);

  const cov = Clearing.computeLossCoverage(
    tally?.available || 0,
    tally?.margin || 0,
    optionAdj
  );

  console.log('--- option liquidation scenario ---');
  console.log('seriesId:', seriesId);
  console.log('address:', address);
  console.log('block:', block);
  console.log('spot:', spot);
  console.log('collateralId:', collateralId);
  console.log('tally:', {
    available: tally?.available || 0,
    margin: tally?.margin || 0
  });
  console.log('optionAdj:', optionAdj);
  console.log('coverageParts:', {
    maintBase: cov.maintBase.toNumber(),
    optionMTM: cov.optionMTM.toNumber(),
    optionMaint: cov.optionMaint.toNumber(),
    coverage: cov.coverage.toNumber()
  });
  console.log('liqThresholdLoss:', cov.coverage.toNumber());
}

main().catch((e) => {
  console.error('optionsLiquidationScenario failed:', e.message || e);
  process.exit(1);
});
