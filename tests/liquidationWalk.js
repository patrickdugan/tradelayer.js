/**
 * liquidationWalk.js
 *
 * Purpose:
 *  - Walk oracle price to liquidation / bankruptcy targets
 *  - Enforce 5% max oracle move per publish (double-tap when needed)
 *  - NO assertions here — verification is a separate script
 */

const {
    publishBTCPrice,
    waitForBlock
} = require('../utils/publishOracle.js'); // adjust path if needed

const CONTRACT_ID = 3;
const ORACLE_ID   = 2;
const MAX_MOVE    = 0.05;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function cappedMove(fromPrice, toPrice) {
    const maxUp   = fromPrice * (1 + MAX_MOVE);
    const maxDown = fromPrice * (1 - MAX_MOVE);

    if (toPrice > maxUp)   return Number(maxUp.toFixed(8));
    if (toPrice < maxDown) return Number(maxDown.toFixed(8));
    return Number(toPrice.toFixed(8));
}

async function stepOracle(fromPrice, targetPrice) {
    let current = fromPrice;

    // first tap
    const step1 = cappedMove(current, targetPrice);
    await publishBTCPrice(CONTRACT_ID, ORACLE_ID, step1);
    await waitForBlock();
    current = step1;

    // second tap if required
    if (current !== targetPrice) {
        const step2 = cappedMove(current, targetPrice);
        await publishBTCPrice(CONTRACT_ID, ORACLE_ID, step2);
        await waitForBlock();
        current = step2;
    }

    return current;
}

// ------------------------------------------------------------
// Scenario runner
// ------------------------------------------------------------

async function runScenario(scenario) {
    console.log(`--- LIQUIDATION WALK ${scenario} ---`);

    // Baseline — adjust if you want to start at live oracle price
    let price = 155;

    switch (scenario) {

        // ----------------------------------------------------
        // E3: Partial liquidation (cross liq, not bankruptcy)
        // ----------------------------------------------------
        case 'E3':
            // long liq ≈ 138.4, stay above bankruptcy
            price = await stepOracle(price, 138.5);
            break;

        // ----------------------------------------------------
        // E4: Full liquidation to zero
        // ----------------------------------------------------
        case 'E4':
            price = await stepOracle(price, 138.5); // liq
            price = await stepOracle(price, 130.0); // bankruptcy
            break;

        // ----------------------------------------------------
        // E5: Liquidate then bounce
        // ----------------------------------------------------
        case 'E5':
            price = await stepOracle(price, 138.5); // liq
            price = await stepOracle(price, 145.0); // recovery (capped)
            break;

        // ----------------------------------------------------
        // E6: Multi-user liquidation (same oracle print)
        // ----------------------------------------------------
        case 'E6':
            price = await stepOracle(price, 138.5);
            break;

        // ----------------------------------------------------
        // E7: Liquidation while resting orders exist
        // ----------------------------------------------------
        case 'E7':
            price = await stepOracle(price, 138.5);
            break;

        // ----------------------------------------------------
        // E8: Flip then immediate oracle cross
        // ----------------------------------------------------
        case 'E8':
            // flip happens in tradeConfig
            price = await stepOracle(price, 138.5);
            break;

        default:
            throw new Error(`Unknown scenario ${scenario}`);
    }

    console.log(`--- WALK COMPLETE @ ${price} ---`);
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------

async function main() {
    const scenario = process.argv[2];
    if (!scenario) {
        console.error('Usage: node liquidationWalk.js <E3|E4|E5|E6|E7|E8>');
        process.exit(1);
    }

    await runScenario(scenario);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
