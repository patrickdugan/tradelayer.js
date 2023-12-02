// Import required modules and utilities
const TxUtils = require('./txUtils.js');
const TxUtilsA = require('./txUtilsA.js');
const Encode = require('./txEncoder.js');
const assert = require('assert');

const address = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"
const fundingInput = "57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5"
const vOut = 1 

// Define the test for activation transaction
        // Setup test parameters
    async function test(){
        const activationParam = 0;


        // Encode the activation transaction
        const encodedData = Encode.encodeActivateTradeLayer({ code: activationParam });
        //console.log(encodedData)
        // Assuming you have a function in TxUtils to create a transaction
        // This function should use the encodedData to create the transaction
        var transaction = await TxUtilsA.beginRawTransaction(fundingInput,vOut)
        //console.log(transaction)
        transaction = await TxUtilsA.addPayload(encodedData,transaction)
        console.log(transaction)
        transaction = await TxUtilsA.setChange(address,null,transaction)
        console.log(transaction)

        // Assertions to validate the transaction
        //assert.strictEqual(transaction.txid, activationParam, 'Transaction ID does not match the parameter');
        //assert.strictEqual(transaction.payload, encodedData, 'Payload encoding is incorrect');

        // Add more assertions as needed

        // Log success or any additional information
        console.log('Activation transaction created successfully:', transaction);
    }

    test()
