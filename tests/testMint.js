const txUtils = require('./txUtils'); // Make sure this path matches where txUtils.js is located

async function createMintTransaction() {
    const thisAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'; // Replace with your address
    const params = {
        propertyIdUsed: 5,      // Replace with the actual property ID
        contractIdUsed: 4,      // Replace with the actual contract ID
        amount: 3,               // Replace with the amount to mint
    };

    try {
        const mintTransaction = await txUtils.createMintTransaction(thisAddress, params);
        console.log('Mint Transaction Created:', mintTransaction);
        // Here you would send the transaction using a web3 library or your preferred method
    } catch (error) {
        console.error('Error creating mint transaction:', error);
    }
}

// Call the function to create the transaction
createMintTransaction();
