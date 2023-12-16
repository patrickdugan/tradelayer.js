const TallyMap = require('./tally.js');
const Logic = require('./logic.js');
const expressInterface = require('./interfaceExpress.js');

async function testSendTLVEST() {
    // Initialize components
    const tallyMap = TallyMap.getInstance();

    // New address generated from the sendTransactionTest script
    const newAddress = 'LYmNegGLoo1Vf4ZUs9k2yskfUgacRS678j'; // Replace with the actual generated address

    // Wait for a few minutes to allow the transaction to be processed
    /*console.log('Waiting for transaction to be processed...');
    await new Promise(resolve => setTimeout(resolve, 3 * 60 * 1000)); // 3 minutes*/

    // Check balances
    const TLVESTPropertyId = 2; // Assuming TLVEST has property ID 2
    const newAddressBalance = await expressInterface.getAllBalancesForAddress(newAddress);
    console.log('New address balance:', newAddressBalance);

    // Assertions (pseudo-code)
    // assert(newAddressBalance.vesting === 1, 'Vesting balance should be 1 TL');
}

testSendTLVEST();
