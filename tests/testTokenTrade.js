const TxUtils = require('./TxUtils'); // Import your TxUtils class

async function runTestTokenTrades() {
    // Define some sample data for testing
    const testAdminAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'; // Replace with actual admin address
    const counterparty = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'//tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr'
function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

var random = randomNumber(1,10)
var random2 = randomNumber(1,10)

    // Sample data for token trades
    const trades = [
        { offeredPropertyId: 5, desiredPropertyId: 4, amountOffered: 9, amountExpected: 7}//random2}
    ];

    // Iterate over each trade and create a transaction
    for (let trade of trades) {
        try {
            console.log(`Creating trade: Offered Property ID ${trade.offeredPropertyId}, Desired Property ID ${trade.desiredPropertyId}`);
            const txId = await TxUtils.tokenTradeTransaction(
                counterparty,
                trade.offeredPropertyId,
                trade.desiredPropertyId,
                trade.amountOffered,
                trade.amountExpected
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
