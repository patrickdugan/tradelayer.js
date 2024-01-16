const path = require('path');
const TradeHistoryManager = require('./tradeHistoryManager.js');

async function runExample() {
    const tradeHistoryManager = new TradeHistoryManager();
    const address = "tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk";
    const contractId = 1;

    // Display position history for the given address and contract ID
    const positionHistory = await tradeHistoryManager.getPositionHistoryForContract(address, contractId);
    console.log(`Position History for Address ${address} and Contract ID ${contractId}:`);
    console.table(positionHistory);

    // Get categorized trades
    const categorizedTrades = await tradeHistoryManager.getCategorizedTrades(address, contractId);
    console.log("Open Trades:", categorizedTrades.openTrades);
    console.log("Partially Closed Trades:", categorizedTrades.partiallyClosedTrades);
    console.log("Closed Trades:", categorizedTrades.closedTrades);
}

// Call the async function
runExample();
