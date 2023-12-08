const litecoin = require('litecoin');
const json = require('big-json');
const util = require('util')
const txUtils = require('./txUtils')
const Types = require('./types.js')
const { txIndexDB } = require('./db.js'); // Import sublevel for txIndex

class TxIndex {
   static instance;

    constructor(test) {
        if (TxIndex.instance) {
            return TxIndex.instance;
        }

        const clientConfig = test ? {
            host: '127.0.0.1',
            port: 18332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        } : {
            host: '127.0.0.1',
            port: 8332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        };

        this.client = new litecoin.Client(clientConfig);
        this.decoderawtransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'decoderawtransaction'));
        this.getTransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'gettransaction'));
        this.transparentIndex = [];

        TxIndex.instance = this;
    }
    
    static async initializeIndex(genesisBlock) {
        await txIndexDB.put('genesisBlock', genesisBlock);
        // Set the indexExists key to indicate the index is being created
        await txIndexDB.put('indexExists', true);
    }

    static async extractBlockData(startHeight) {
        var chainTip = await this.fetchChainTip();
        for (let height = startHeight; height <= chainTip; height++) {
            var blockData = await this.fetchBlockData(height);
            await this.processBlockData(blockData, height);
            chainTip = await this.fetchChainTip()
        }
        console.log('indexed to chaintip')
    }

    static async checkForIndex() {
        try {
            // Check for the special key indexExists
            await txIndexDB.get('indexExists');
            return true; // The index exists
        } catch (error) {
            if (error.type === 'NotFoundError') {
                return false; // The index does not exist
            } else {
                console.error('Error checking for index:', error);
                throw error; // Handle other errors appropriately
            }
        }
    }

    static async fetchChainTip() {
        return new Promise((resolve, reject) => {
            this.client.getBlockCount((error, chainTip) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(chainTip);
                }
            });
        });
    }

    static async fetchBlockData(height) {
        return new Promise((resolve, reject) => {
            this.client.getBlockHash(height, (error, blockHash) => {
                if (error) {
                    reject(error);
                } else {
                    this.client.getBlock(blockHash, (error, block) => {
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

    static async saveTransactionByHeight(txId, blockHeight) {
        try {
            const txKey = `txHeight-${blockHeight}-${txId}`;
            const txData = await this.fetchTransactionData(txId);

            // Log the data to be saved (for diagnostic purposes)
            console.log(`Saving transaction data for key ${txKey}:`, txData);

            if (txData) {
                await txIndexDB.put(txKey, JSON.stringify(txData));
                console.log(`Transaction data saved successfully for key ${txKey}`);
            } else {
                console.log(`No transaction data found for txId ${txId}`);
            }
        } catch (error) {
            console.error(`Error in saveTransactionByHeight for txId ${txId}:`, error);
        }
    }

    static async fetchTransactionData(txId) {
        return new Promise((resolve, reject) => {
            this.client.getRawTransaction(txId, true, (error, transaction) => {
                if (error) {
                    console.log(error)
                    reject(error);
                } else {
                    resolve(transaction.hex);
                }
            });
        });
    }

    static async DecodeRawTransaction(rawTx) {
        try {
            const decodedTx = await this.decoderawtransactionAsync(rawTx);
            
            if(rawTx=="02000000000101be64c98a4c17b5861b45b2602873212cb0ada374539c7b61593b2d3e47b8e5cd0100000000ffffffff020000000000000000066a04746c303080b9ff0600000000160014ebecd536259ef21bc6ecc18e45b35412f04722900247304402201ac4b0e373e7555d502e80b5424683dd1da2ca8052793bd2c62d64b2e9370367022014e72b32507262b3c78848b81558acfb2c9f9cb2a8c7968b65615888e7f04d0b012103d6521aea309f7a2768a1cabcb917664966cabc28bc23874b12f73c1989972c5f00000000"){
                console.log('Decoded Transaction:', decodedTx);
            }

            const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

            if (opReturnOutput) {
                const opReturnData = opReturnOutput.scriptPubKey.hex;
                //console.log('OP_RETURN Data:', opReturnData);

                // Extract and log the "tl" marker
                const markerHex = opReturnData.substring(4, 8); // '746c' for 'tl'
                const marker = Buffer.from(markerHex, 'hex').toString();
                if(marker=='tl'){console.log('Marker:', marker);}

                // Extract and log the actual payload
                const payloadHex = opReturnData.substring(8);
                const payload = Buffer.from(payloadHex, 'hex').toString();
                if(marker=='tl'){console.log('Decoded Payload:', payload)};


                return { marker, payload , decodedTx};
            } else {
                //console.log('No OP_RETURN output found.');
                return null;
            }
        } catch (error) {
            //console.error('Error decoding raw transaction:', error);
        }
    }

    static async processBlockData(blockData, blockHeight) {
         for (var txId of blockData.tx) {
            const txHex = await this.fetchTransactionData(txId);   
            const txData = await this.DecodeRawTransaction(txHex)
            
            if(txData != null){
                if (txData.marker === 'tl') {
                    this.transparentIndex.push(txData.payload)
                    const txDetails = await this.processTransaction(txData.payload, txData.decodedTx, txId, txData.marker);
                    await this.saveTransactionData(txId, txData.decodedTx, txData.payload, blockHeight, txDetails);
                    //console.log(txDetails)
                   
                    // Save each transaction with its block height as a key
                    await this.saveTransactionByHeight(txId, blockHeight);
                }
            }
        }
    }

    static async processTransaction(payload, decode, txid, marker) {
        // Example: Extract sender, reference address, payload, etc.
        // These methods can be similar to those in TxUtils
        const sender = await txUtils.getSender(txid);
        const reference = await txUtils.getReference(txid);
        // Decode the transaction based on its type and payload
        // Extract and process the actual payload
        const decodedParams = Types.decodePayload(txid, marker, payload);

        return { sender, reference, payload, decodedParams};
    }

    // New method to find the maximum block height
    static async findMaxIndexedBlock() {
        return new Promise((resolve, reject) => {
            let maxBlockHeight = 0;
            txIndexDB.createKeyStream()
                .on('data', (key) => {
                    const height = parseInt(key.split('-')[1]);
                    console.log('txindex height '+height)
                    if (height > maxBlockHeight) {
                        maxBlockHeight = height;
                    }
                })
                .on('error', (err) => {
                    console.log("can't find maxIndexedBlock"+err)
                    reject(err);
                })
                .on('end', async () => {
                    try {
                        await txIndexDB.put('maxIndexHeight', maxBlockHeight);  // Save the max block height
                        resolve(maxBlockHeight);
                    } catch (err) {
                        reject(err);
                    }
                });
        });
    }

    // Updated saveTransactionData method
    static async saveTransactionData(txId, txData, payload, blockHeight) {
        const indexKey = `tx-${blockHeight}-${txId}`;
        await txIndexDB.put(indexKey, JSON.stringify({ txData, payload }));
    }

    static async loadIndex() {
        return new Promise((resolve, reject) => {
            let data = {};
            txIndexDB.createReadStream() // Using txIndex sublevel
                .on('data', (entry) => {
                    data[entry.key] = entry.value;
                })
                .on('error', (err) => {
                    console.error('Stream encountered an error:', err);
                    reject(err);
                })
                .on('close', () => {
                    console.log('Stream closed');
                })
                .on('end', () => {
                    console.log('Stream ended');
                    resolve(data);
                });
        });
    }

    static async clearTxIndex() {
        try {
            // Clear the entire txIndexDB sublevel
            await txIndexDB.clear();
            console.log('txIndexDB cleared successfully.');
        } catch (error) {
            console.error('Error in clearing txIndexDB:', error);
        }
    }


}

module.exports = TxIndex;
