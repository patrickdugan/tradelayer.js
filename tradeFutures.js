const crypto = require('crypto');
const TxUtils = require('./txUtils.js'); // Assuming TxUtils contains necessary functions

async function generateTrades(adminAddress, otherAddress) {
    const contractId = 1; // Contract ID for the trades
    const propertyId = 3; // Property ID used in the trades
    const btcPrice = 43000; // Base price for BTC
    const priceVariation = 300; // Price variation range (+/-)

    for (let i = 0; i < 10; i++) { // Generate 10 random trades
        const isBuyOrder = Math.random() < 0.5; // Randomly determine if it's a buy or sell order
        const priceOffset = Math.floor(Math.random() * priceVariation) - (priceVariation / 2);
        const tradePrice = btcPrice + priceOffset; // Randomize trade price

        const traderAddress = isBuyOrder ? adminAddress : otherAddress;
        const tradeType = isBuyOrder ? 'Buy' : 'Sell';
        const amount = Math.floor(Math.random() * 10) + 1; // Random amount between 1 and 10

        // Prepare trade parameters
        const tradeParams = {
            contractId: contractId,
            propertyId: propertyId,
            amount: amount,
            price: tradePrice,
            type: tradeType
        };

        // Create trade transaction
        await TxUtils.createContractOnChainTradeTransaction(traderAddress, tradeParams, 18);
    }
}

// Addresses for the trades
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";
const otherAddress = "mj4iTwbHiQX6objWNXHjerF2KQDFcPCdUx";

// Execute the function to generate trades
generateTrades(adminAddress, otherAddress).then(() => {
    console.log('Trades generated successfully');
}).catch(error => {
    console.error('Error generating trades:', error);
});
