const txUtils = require('./txUtils'); // Make sure this path matches where txUtils.js is located

async function createRedeemTransaction() {
     const thisAddress = 'tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr'; // Replace with your address
    const params = {
        propertyIdUsed: 5,      // Replace with the actual property ID
        contractIdUsed: 4,      // Replace with the actual contract ID
        amount: 1.8,               // Replace with the amount to mint
    };


    try {
        const redeemTransaction = await txUtils.createRedeemTransaction(thisAddress, params);
        console.log('Redeem Transaction Created:', redeemTransaction);
        // Here you would send the transaction using a web3 library or your preferred method
    } catch (error) {
        console.error('Error creating redeem transaction:', error);
    }
}

// Call the function to create the transaction
createRedeemTransaction();
