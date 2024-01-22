const crypto = require('crypto');
const TxUtils = require('./txUtils.js'); // Assuming TxUtils contains necessary functions

async function generateTrades(adminAddress) {
    const contractId = 1; // Contract ID for the trades
    const propertyId = 3; // Property ID used in the trades
    const btcPrice = 42000; // Base price for BTC
    const priceVariation = 100; // Price variation range (+/-)

    for (let i = 0; i < 3; i++) { // Generate 10 random trades
        const priceOffset = Math.floor(Math.random() * priceVariation) - (priceVariation / 2);
        const tradePrice = btcPrice + priceOffset; // Randomize trade price
        const amount = 2//Math.floor(Math.random() * 4) + 1; // Random amount between 1 and 10

        // Prepare trade parameters
        const tradeParams = {
            contractId: contractId,
            propertyId: propertyId,
            amount: amount,
            price: tradePrice,
            side: false // Assuming all trades are 'Buy' orders
        };

        // Create trade transaction
        await TxUtils.createContractOnChainTradeTransaction(adminAddress, tradeParams, 18);
    }
}

// Address for the trades
const adminAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'//tltc1q8xw3vsvkv77dpj59nqn30rxlc9m3xjw76cgrac'//"tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk";
//tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8
// Execute the function to generate trades
generateTrades(adminAddress).then(() => {
    console.log('Trades generated successfully');
}).catch(error => {
    console.error('Error generating trades:', error);
});