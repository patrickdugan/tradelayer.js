const async = require('async');
const litecore = require('bitcore-lib-doge'); // Use Dogecoin version
const Encode = require('../src/txEncoder.js'); // Assuming TradeLayer encoding logic

// Constants
const STANDARD_FEE = 100000000; // Standard fee in satoshis (e.g., 1 DOGE)
const DUST_THRESHOLD = 100000000; // Dogecoin dust threshold (e.g., 1 DOGE)

async function sendDogecoin(senderAddress, recipientAddress, amountToSend) {
    let send = Math.floor(amountToSend * 1e8) - STANDARD_FEE; // Convert to satoshis and subtract fee

    try {
        // Mock UTXO for demonstration (replace with real UTXO fetching logic)
        const utxos = [{
            txId: '502ce433a589184cc04c6ee8ac5260a34acc679ec071c6727c1ebbdcf51cc7a6',
            outputIndex: 0,
            address: senderAddress,
            script: "76a914a7dcce4bf35b50dbe9da38e5dc6758b7ab78ae5a88ac",
            satoshis: 5 * 1e8, // Amount in satoshis
        }];

        // Activation parameters for TradeLayer
        const params = {
            txTypeToActivate: 9, // Activation type
            codeHash: '873af1d08d3603c8296afe6de040d228b76872fa0dc570f7b236dd4900b26f0d',
        };

        // Encode OP_RETURN data for TradeLayer activation
        const opReturnData = Encode.encodeActivateTradeLayer(params);
        console.log('Payload:', opReturnData);

        // Create OP_RETURN script
        const opReturnScript = litecore.Script.buildDataOut(opReturnData);

        // Create a new Dogecoin transaction
        const tx = new litecore.Transaction()
            .from(utxos) // Add UTXOs as inputs
            .to(recipientAddress, send) // Send to recipient
            .fee(STANDARD_FEE) // Set the transaction fee
            .addOutput(new litecore.Transaction.Output({
                script: opReturnScript, // Add OP_RETURN data as output
                satoshis: 0, // OP_RETURN outputs always have 0 value
            }));

        // Serialize the transaction
        const serializedTx = tx.toString();
        console.log(`Transaction hex to sign: ${serializedTx}`);

        // Mock broadcasting (replace with actual broadcast logic)
        // const txid = await sendrawtransactionAsync(serializedTx);
        // console.log(`Transaction broadcasted with txid: ${txid}`);
    } catch (error) {
        console.error('Error sending Dogecoin:', error);
    }
}

// Replace with actual values
const senderAddress = "DLSfu9qvEggkeXAgCAwBBw5BVLvMCtkewz"; // Replace with a valid Dogecoin address
const recipientAddress = "DLSfu9qvEggkeXAgCAwBBw5BVLvMCtkewz"; // Replace with recipient Dogecoin address
const amountToSend = 5; // Amount of DOGE to send

// Execute the function to send Dogecoin
sendDogecoin(senderAddress, recipientAddress, amountToSend);
