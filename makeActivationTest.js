const TxUtils = require('./txUtils.js');
const Encode = require('./txEncoder.js');
const types= require('./types.js')

const fromAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";
const toAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"; // Update this to the desired destination address
const amount = 0; // Set the amount for the transaction

async function makeActivationTest() {
    try {
        const activationParam = 6;
        const encodedData = types.encodePayload(0,{ code: activationParam });

        // Send the transaction
        const txid = await TxUtils.sendTransaction(fromAddress, null, amount, encodedData);

        // Log the transaction ID
        console.log('Activation transaction created successfully:', txid);
    } catch (error) {
        console.error('Error in makeActivationTest:', error);
    }
}

makeActivationTest();