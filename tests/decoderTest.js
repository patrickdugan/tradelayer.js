const Litecoin = require('litecoin'); // Import the litecoin npm package
const util = require('util')

// Litecoin client configuration
const client = new Litecoin.Client({
    host: 'localhost',  // Replace with your Litecoin node's host if different
    port: 18332,        // The port to connect to (RPC port for Litecoin)
    user: 'user', // Replace with your Litecoin RPC username
    pass: 'pass', // Replace with your Litecoin RPC password
    timeout: 30000       // Optional: adjust as needed
});

const block = 3496378

function getBlockHash(height) {
    return util.promisify(client.cmd.bind(client, 'getblockhash'))(height);
  }

function  getrawtransaction(...params) {
    return util.promisify(client.cmd.bind(client, 'getrawtransaction'))(...params);
  }
// Replace with actual method to get raw transaction from txid
async function fetchTransactionData(txId, verbose, block) {
        console.log(block)
        const blockHash = await getBlockHash(block)
       
            const transaction = await getrawtransaction(txId, verbose, blockHash );
            const decodedTx = await DecodeRawTransaction(transaction,true)
    }


    async function DecodeRawTransaction(thisTx,flag) {
        try {
            //const decodedTx = await this.client.decoderawtransaction(rawTx);
            

            const opReturnOutput = thisTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

            console.log(thisTx.vout)


            if (opReturnOutput) {
                console.log('op return ' +opReturnOutput)
                const opReturnData = opReturnOutput.scriptPubKey.hex;
                if(flag){console.log('OP_RETURN Data:', opReturnData)};
                // Extract and log the "tl" marker

                 // Check if the hex contains the marker "746c" (which corresponds to "tl")
                let markerHex = "746c"; // Hex for "tl"
                let payloadStart =8
                let markerPosition = opReturnData.indexOf(markerHex); // Check if the marker is anywhere in the string
                if(flag){console.log('marker position '+markerPosition)}
                if (markerPosition === -1||markerPosition>6) {
                    //console.error('Marker "tl" not found in OP_RETURN data');
                    return null;
                }else if(markerHex = opReturnData.substring(4, 8)){
                    payloadStart= 8
                }else if(markerHex==opReturnData.substring(5, 9)){
                    payloadStart= 9
                }else if(markerHex==opReturnData.substring(6,10)){
                    payloadStart=10
                }; // '746c' for 'tl'
                let marker = Buffer.from(markerHex, 'hex').toString();
                if(flag){console.log('checking marker '+marker+ ' payload start '+payloadStart)}
                // Extract and log the actual payload
                const payloadHex = opReturnData.substring(payloadStart);
                const payload = Buffer.from(payloadHex, 'hex').toString();
                console.log('market data ' +markerHex+' '+marker+' '+payload)
                if(marker=='tl'){console.log('Pre-decoded and Decoded Payload:', opReturnData + ' ' + payload+ ' decoding the whole thing '+Buffer.from(opReturnData, 'hex').toString())};
                return { marker, payload , decodedTx};
            } else {
                //console.log('No OP_RETURN output found.');
                return null;
            }
            // Process decoded transaction logic here...
            return decodedTx;
        } catch (error) {
            //console.error('Error decoding raw transaction:', error);
        }
    }


// Main function to test the txId
async function testTxId(txId) {
    // Fetch the raw transaction data
    const rawTxHex = await fetchTransactionData(txId, true, block);

    if (!rawTxHex) {
        console.log('No raw transaction data found for txId:', txId);
        return;
    }

    // Decode the raw transaction and check for the OP_RETURN marker
    console.log(`Testing txId: ${txId}`);
    await decodeTransaction(rawTxHex);
}

// Test the transaction by its txId
const txId = 'bc395db7a7a11b42e9711e192a860da2fffe64955cae6dd673e267532f328b3d'; // Replace with your txId
testTxId(txId);
