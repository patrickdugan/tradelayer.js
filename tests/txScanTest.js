const litecoin = require('litecoin');

const util = require('util');

const clientConfig = /*test ?*/ {
            host: '127.0.0.1',
            port: 18332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        }


const client = new litecoin.Client(clientConfig);


const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const getTransactionAsync = util.promisify(client.cmd.bind(client, 'gettransaction'));
const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'))

async function processBlockData(blockData, blockHeight) {   
            let txDetails =[]
        for (const txId of blockData.tx) {
            //console.log('txId '+txId)
            if(txId=="883cf77e4d1f5e32969849ca7db9b626f5363af9edf866972de2076313df7f95"){
                //console.log('mmmkay')
                const txHex = await fetchTransactionData(txId);
                const txData = await DecodeRawTransaction(txHex);
                 if (txData != null && txData!= undefined && txData.marker === 'tl') {
                    const payload = txData.payload;
                    //const thisTx = await processTransaction(payload, txId, txData.marker);
                    //txDetails.push(thisTx)
                    console.log('payload '+payload)
                }
            }       
        }
        return txDetails
    }

async function fetchBlockData(height) {
        return new Promise((resolve, reject) => {
            client.getBlockHash(height, (error, blockHash) => {
                if (error) {
                    reject(error);
                } else {
                    client.getBlock(blockHash, (error, block) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(block);
                        }
                    });
                }
            });
        });
    }

async function fetchTransactionData(txId) {
        //console.log('fetching tx data '+txId)
        return new Promise((resolve, reject) => {
            client.getRawTransaction(txId, true, (error, transaction) => {
                if (error) {
                    console.log('blah '+error);
                    reject(error);
                } else {
                    resolve(transaction.hex);
                }
            });
        });
    }

async function DecodeRawTransaction(rawTx) {
        try {
            const decodedTx = await decoderawtransactionAsync(rawTx);
            //console.log(JSON.stringify(decodedTx))

            const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');
            if (opReturnOutput) {
                const opReturnData = opReturnOutput.scriptPubKey.hex;
                console.log('OP_RETURN Data:', opReturnData);
                // Extract and log the "tl" marker
                let markerHex = opReturnData.substring(4, 8); // '746c' for 'tl'
                let marker = Buffer.from(markerHex, 'hex').toString();
                let payloadStart= 8
        
                if (marker != 'tl'&&marker.includes('t')) {
                    console.log('Entering weird OP_Return pacing block');
                    console.log('Current marker:', marker);
                    try {
                        console.log('weird OP_Return pacing', opReturnData.substring(6, 10));
                        markerHex = opReturnData.substring(6, 10);
                        marker = Buffer.from(markerHex, 'hex').toString();
                        payloadStart = 10;
                        if(marker != 'tl'){
                            markerHex = opReturnData.substring(5, 9);
                            marker = Buffer.from(markerHex, 'hex').toString();
                            if(marker != 'tl'){
                                return null
                            }
                            payloadStart = 9;
                        }
                        console.log('fixed?', marker);
                    } catch (error) {
                        console.error('Error in processing:', error);
                    }
                }
                // Extract and log the actual payload
                const payloadHex = opReturnData.substring(payloadStart);
                const payload = Buffer.from(payloadHex, 'hex').toString();
                console.log(markerHex+' '+marker+' '+payload)
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

async function doEit(){

const height = 3432676
let blockData = await fetchBlockData(height);

let txDetails = await processBlockData(blockData, height);

console.log('ok n ow' +JSON.stringify(txDetails))
}

doEit()
