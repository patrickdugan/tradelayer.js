const crypto = require('crypto');
const TxUtils = require('../src/txUtils.js'); // Assuming TxUtils contains necessary functions

async function generateTrades(adminAddress) {
    const contractId = 4; // Contract ID for the trades
    const propertyId = 3; // Property ID used in the trades
    const btcPrice = 50000; // Base price for BTC
    const priceVariation = 100; // Price variation range (+/-)

    for (let i = 0; i < 1; i++) { // Generate 10 random trades
        const priceOffset = Math.floor(Math.random() * priceVariation) - (priceVariation / 2);
        const tradePrice = btcPrice + priceOffset; // Randomize trade price
        const amount = Math.floor(Math.random() * 3) + 1; // Random amount between 1 and 10

        // Prepare trade parameters
        const tradeParams = {
            contractId: contractId,
            amount: amount,
            price: tradePrice,
            sell: false // TrueAssuming all trades are '' orders
        };

        // Create trade transaction
        await TxUtils.createContractOnChainTradeTransaction(adminAddress, tradeParams, 18);
    }
}

// Address for the trades
const adminAddress = 'tltc1qtee90ysf57393hfqyn79syj9mkekm7hq0epqzw'//'tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr' 
//tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'
//'//tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk'
//tltc1q8xw3vsvkv77dpj59nqn30rxlc9m3xjw76cgrac'
//"tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk";
//
// Execute the function to generate trades
generateTrades(adminAddress).then(() => {
    console.log('Trades generated successfully');
}).catch(error => {
    console.error('Error generating trades:', error);
});
