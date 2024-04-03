const path = require('path');
const TradeHistory = require('./tradeHistoryManager.js');

async function runExample() {
    const tradeHistoryManager = new TradeHistory();
    const address = 'tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk';
    const address2 = 'tltc1q8xw3vsvkv77dpj59nqn30rxlc9m3xjw76cgrac';
    const address3 = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
    const contractId = 1;

    // Display position history for the given address and contract ID
    const positionHistory = await tradeHistoryManager.trackPositionHistory(address, contractId);
    console.log(`Position History for Address ${address} and Contract ID ${contractId}:`);
    console.table(positionHistory);

    const positionHistory2 = await tradeHistoryManager.trackPositionHistory(address2, contractId);
    console.log(`Position History for Address ${address2} and Contract ID ${contractId}:`);
    console.table(positionHistory2);

    const positionHistory3 = await tradeHistoryManager.trackPositionHistory(address3, contractId);
    console.log(`Position History for Address ${address3} and Contract ID ${contractId}:`);
    console.table(positionHistory3);

    // Get categorized trades
    /*const categorizedTrades = await tradeHistoryManager.getCategorizedTrades(address, contractId);
    console.log("Open Trades:", categorizedTrades.openTrades);
    console.log("Close Trades:", categorizedTrades.closeTrades);

    // Example usage
    const avgEntryPrices = tradeHistoryManager.computeAverageEntryPrices(categorizedTrades.openTrades);
    console.log("Average Entry Prices:", avgEntryPrices);*/
}

// Call the async function
runExample();
