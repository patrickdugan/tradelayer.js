const Logic = require('./Logic'); // Assuming Logic is the module with your business logic
const TxUtils = require('./TxUtils'); // Assuming TxUtils contains your utility functions

async function testSendLargeAmount() {
    // Initialize components
    const adminAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'; // Replace with actual admin address
    const TLVESTPropertyId = 2; // Assuming TLVEST has property ID 2
    const largeAmount = 2000000;
    // Send a large amount of TLVEST from admin address
    try {
        const sendTxId = await TxUtils.sendTransaction(adminAddress, 'LNmiS6p8z3KuHHx3q6Jf6x6TfcyptE68oP', TLVESTPropertyId, largeAmount, false);
        console.log('Send Transaction ID:', sendTxId);
    } catch (error) {
        console.log('Expected error:', error.message);
        // Assertions (pseudo-code)
        // assert(error.message.includes('Insufficient balance'), 'Transaction should be invalid due to insufficient balance');
    }
}

testSendLargeAmount();