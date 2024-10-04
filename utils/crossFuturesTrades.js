const TxUtils = require('./TxUtils'); // Import your TxUtils class

async function runTestTokenTrades() {
    const testAdminAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'; // Replace with actual admin address
    const counterparties = [
        'tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr',
        'tltc1qhgfrkv89lwp8vmygyqzt8ljvzn7g5z4sk9krw0',
        'tltc1qr5ewrtxgj3z54gv9l47xz3cwrp6js9pgfxad2h'
    ];

    function randomNumber(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Generate random trades
    function generateRandomTrades(numTrades) {
        const trades = [];
        for (let i = 0; i < numTrades; i++) {
            const random = randomNumber(1, 3);
            const random2 = randomNumber(1, 10);
            const counterparty = counterparties[i % counterparties.length];
            trades.push({
            contractId: 4,
            amount: random,
            price: random2,
            side: true, // Assuming all trades are 'Buy' orders
            address: counterparty,
            insurance:false,
            fee: false,
            reduce: false,
            post: false,
            stop: false
            });
        }
        return trades;
    }

    const trades = generateRandomTrades(10); // Generate 10 trades for each side

    // Iterate over each trade and create a transaction
    for (let trade of trades) {
        try {
            console.log(`Creating trade: Offered Property ID ${trade.offeredPropertyId}, Desired Property ID ${trade.desiredPropertyId}, Address: ${trade.address}`);
            const txId = await TxUtils.createContractOnChainTradeTransaction(
                trade.address,
                trade
            );
            console.log(`Transaction ID: ${txId}`);
        } catch (error) {
            console.error(`Error creating trade for offered property ${trade.offeredPropertyId} and desired property ${trade.desiredPropertyId}:`, error);
        }
    }
}

runTestTokenTrades()
    .then(() => console.log('Test token trade transactions completed.'))
    .catch(error => console.error('Error running test token trades:', error));
