/**
 * liquidationWalk.js
 *
 * Purpose:
 *  - Walk oracle price deterministically
 *  - Trigger:
 *      * partial liquidation
 *      * full liquidation
 *      * bankruptcy
 *      * ADL
 *
 * Uses existing publishOracle.js
 */

const { publishBTCPrice } = require('../utils/publishOracle.js');

const CONTRACT_ID = 3;
const ORACLE_ID   = 2;

// Baseline confirmed by you
const START_PRICE = 180;

// Controlled walk
const ORACLE_PATH = [
  175,  // stress
  170,  // margin pressure
  165,  // first liqs likely
  150,  // partial liquidation zone
  130,  // bankruptcy candidates
  110,  // insurance drain
  90    // ADL almost guaranteed
];

async function run() {

  console.log('--- ORACLE WALK START ---');

  // Ensure deterministic anchor
  await publishBTCPrice({
    oracleId: ORACLE_ID,
    contractId: CONTRACT_ID,
    price: START_PRICE
  });

  for (const price of ORACLE_PATH) {
    console.log(`Publishing oracle price → ${price}`);
    await publishOracle({
      oracleId: ORACLE_ID,
      contractId: CONTRACT_ID,
      price
    });

    // Give your engine a breath if needed
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('--- ORACLE WALK END ---');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
