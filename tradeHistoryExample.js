const path = require('path');
const TradeHistoryManager  = require('./tradeHistoryManager.js');

const tradeHistoryManager = new TradeHistoryManager();
const address = "tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk";
const contractId = 1;

// Display position history for the given address and contract ID
tradeHistoryManager.displayPositionHistory(address, contractId);

// Get categorized trades
const categorizedTrades = tradeHistoryManager.getCategorizedTrades(address, contractId);
console.log("Open Trades:", categorizedTrades.openTrades);
console.log("Partially Closed Trades:", categorizedTrades.partiallyClosedTrades);
console.log("Closed Trades:", categorizedTrades.closedTrades);
