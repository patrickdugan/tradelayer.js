const litecoin = require('litecoin');
const json = require('big-json');
const util = require('util');
const TxUtils = require('./txUtils');
const Types = require('./types.js');
const db = require('./db.js');

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
const transparentIndex = [];

class TxIndex {
    static instance;

    constructor(test) {
        if (TxIndex.instance) {
            return TxIndex.instance;
        }

         /*: {
            host: '127.0.0.1',
            port: 8332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        };*/

        TxIndex.instance = this;
    }

    static getInstance(test) {
        if (!TxIndex.instance) {
            TxIndex.instance = new TxIndex(test);
        }
        return TxIndex.instance;
    }

    static async initializeIndex(genesisBlock) {
             try {
            const existingGenesisBlock = await db.getDatabase('txIndex').findOneAsync({ _id: 'genesisBlock' });
            if (existingGenesisBlock) {
                console.log('Genesis block is already initialized:', existingGenesisBlock.value);
                return;
            }
        } catch (error) {
            // Handle any errors that occur during database access
            console.error('Error checking for existing genesis block:', error);
            throw error;
        }

        // If the "genesisBlock" key does not exist, initialize it
        try {
            await db.getDatabase('txIndex').insertAsync({ _id: 'genesisBlock', value: genesisBlock });
            console.log('Genesis block initialized:', genesisBlock);
        } catch (error) {
            // Handle any errors that occur during insertion
            console.error('Error initializing genesis block:', error);
            throw error;
        }
    }

    static async extractBlockData(startHeight) {
        let chainTip = await this.fetchChainTip();
        //console.log('building index until' + chainTip);
        for (let height = startHeight; height <= chainTip; height++) {
            //console.log(height);
            let blockData = await this.fetchBlockData(height);
            //console.log(blockData)
            await this.processBlockData(blockData, height);
            //chainTip = await this.fetchChainTip();
        }
        console.log('indexed to chaintip');
        
        // Use the correct NeDB method to insert or update the 'indexExists' document
         // After processing the block, update 'MaxHeight'
            try {
                await db.getDatabase('txIndex').updateAsync(
                    { _id: 'MaxHeight' },
                    { _id: 'MaxHeight', value: chainTip },
                    { upsert: true }
                );
            } catch (error) {
                console.error('Error updating MaxHeight:', error);
                throw error;
            }

            try {
                await db.getDatabase('txIndex').updateAsync(
                    { _id: 'indexExists' },
                    { _id: 'indexExists', value: true },
                    { upsert: true } // This option ensures that the document is inserted if it doesn't exist or updated if it does.
                );
                console.log('Index flag set successfully.');
            } catch (error) {
                console.error('Error setting the index flag:', error);
                throw error;
            }

                console.log('built index');
    }


    static async fetchChainTip() {
        return new Promise((resolve, reject) => {
            client.getBlockCount((error, chainTip) => {
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

    static async processBlockData(blockData, blockHeight) {
            const txIndexDB = db.getDatabase('txIndex');
        for (const txId of blockData.tx) {
            const txHex = await TxIndex.fetchTransactionData(txId);
            const txData = await TxIndex.DecodeRawTransaction(txHex);
            if (txData != null && txData!= undefined && txData.marker === 'tl') {
                const payload = txData.payload;
                const txDetails = await TxIndex.processTransaction(payload, txId, txData.marker);
                console.log(payload)
                await txIndexDB.insertAsync({ _id: `tx-${blockHeight}-${txId}`, value: txDetails });            
            }
        }
    }

    static async fetchTransactionData(txId) {
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

    static async DecodeRawTransaction(rawTx) {
        try {
            const decodedTx = await decoderawtransactionAsync(rawTx);
            //console.log(decodedTx)
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
            // Process decoded transaction logic here...
            return decodedTx;
        } catch (error) {
            //console.error('Error decoding raw transaction:', error);
        }
    }

    static async processTransaction(payload, txId, marker) {
        // Process the transaction...
        const sender = await TxUtils.getSender(txId);
        const reference = await TxUtils.getReference(txId);
        const decodedParams = Types.decodePayload(txId, marker, payload);
        return { sender, reference, payload, decodedParams, marker };
    }

    async saveTransactionData(txId, txData, payload, blockHeight, txDetails) {
        const indexKey = `tx-${blockHeight}-${txId}`;
        const document = {
            _id: indexKey,
            txData: txDetails
        };

        console.log(document);

        try {
            // Check if the document already exists
            const existingDocument = await db.getDatabase('txIndex').findOneAsync({ _id: indexKey });

            if (existingDocument) {
                // Document exists, perform an update
                const update = { $set: { txData, payload } };
                await db.getDatabase('txIndex').updateAsync({ _id: indexKey }, update);
                console.log(`Transaction data updated for ${indexKey}`);
            } else {
                // Document does not exist, perform an insert
                await db.getDatabase('txIndex').insertAsync(document);
                console.log(`Transaction data inserted for ${indexKey}`);
            }
        } catch (error) {
            // Handle any errors
            console.error(`Error saving transaction data for ${indexKey}: ${error}`);
        }
    }



     async loadIndex() {
        return new Promise((resolve, reject) => {
            let data = {};
            db.getDatabase('txIndex')
                .findAsync({})
                .then(entries => {
                    entries.forEach(entry => {
                        data[entry._id] = entry.value;
                    });
                    resolve(data);
                })
                .catch(err => {
                    console.error('Error loading index:', err);
                    reject(err);
                });
        });
    }

       async upsertTxValidityAndReason(txId, blockHeight, isValid, reason) {
        const indexKey = `tx-${blockHeight}-${txId}`;
        
        try {
            // Assuming the database instance is accessible as `db`
            await db.getDatabase('txIndex').update(
                { _id: indexKey },
                { $set: { valid: isValid, reason: reason }},
                { upsert: true }
            );
            console.log(`Transaction ${indexKey} validity updated in txIndex.`);
        } catch (error) {
            console.error(`Error updating transaction ${indexKey} in txIndex:`, error);
        }
    }


    static async clearTxIndex() {
            return new Promise(async (resolve, reject) => {
                try {
                    // Initialize your NeDB database
                    const db = new Datastore({ filename: 'your_nedb_database.db', autoload: true });

                    // Remove all documents from the txIndex collection
                    await db.remove({}, { multi: true });

                    console.log('Cleared all entries from txIndexDB.');
                    resolve();
                } catch (error) {
                    console.error('Error in clearing txIndexDB:', error);
                    reject(error);
                }
            });
        }

    async initializeOrLoadDB(genesisBlock) {
        return new Promise(async (resolve, reject) => {
            try {
                // Access the txIndex database using dbInstance
                const txIndexDB = db.getDatabase('txIndex');

                // Attempt to find the 'genesisBlock' key
                txIndexDB.findOneAsync({ _id: 'genesisBlock' })
                    .then(doc => {
                        if (!doc) {
                            // If 'genesisBlock' key does not exist, initialize it
                            console.log('Initializing database with genesis block:', genesisBlock);
                            return txIndexDB.insertAsync({ _id: 'genesisBlock', value: genesisBlock });
                        } else {
                            //console.log('Database already initialized. Genesis block:', doc.value);
                            // Database already exists, resolve the promise
                            return Promise.resolve();
                        }
                    })
                    .then(() => resolve())
                    .catch(error => {
                        console.error('Error accessing database:', error);
                        reject(error);
                    });
            } catch (error) {
                console.error('Error accessing database:', error);
                reject(error);
            }
        });
    }



    static async resetIndexFlag() {
        await txIndexDB.del('indexExists');
        await txIndexDB.del('genesisBlock');
        console.log('Index flags reset successfully.');
    }

    static async findMaxIndexedBlock() {
        try {
            const txIndexDB = db.getDatabase('txIndex');
            const maxHeightDoc = await txIndexDB.findOneAsync({ _id: 'MaxHeight' });

            if (maxHeightDoc) {
                return maxHeightDoc.value;
            } else {
                // Handle the case where MaxHeight hasn't been set yet
                console.log('MaxHeight not found in txIndexDB.');
                return 0; // or an appropriate default/fallback value
            }
        } catch (err) {
            console.error('Error finding MaxIndexedBlock:', err);
            throw err;
        }
    }

    /**
     * Retrieves and deserializes data for a given transaction ID from the txIndex database.
     * @param {string} txId The transaction ID to query.
     * @returns {Promise<object|null>} The deserialized transaction data or null if not found.
     */
    static async getTransactionData(txId) {
        try {
            const txIndexDB = db.getDatabase('txIndex');
            const blockHeight = TxIndex.fetchChainTip()
            const txData = await txIndexDB.findOneAsync({ _id: indexKey });

            if (txData) {
                console.log(`Transaction data found for ${txId}:`, txData);
                return txData.value; // Return the value part of the transaction data
            } else {
                console.log(`No transaction data found for ${txId}.`);
                return null;
            }
        } catch (error) {
            console.error(`Error retrieving transaction data for ${txId}:`, error);
            throw error;
        }
    }

    static async checkForIndex() {
        try {
            const txIndexDB = db.getDatabase('txIndex');
            const indexExistsValue = await txIndexDB.findOneAsync({ _id: 'indexExists' });

            if (indexExistsValue) {
                console.log(`'indexExists' key found with value: ${indexExistsValue.value}`);
                return true; // The index exists
            } else {
                console.log("'indexExists' key not found.");
                return false; // The index does not exist
            }
        } catch (error) {
            console.error('Error checking for index:', error);
            throw error;
        }
    }


}

module.exports = TxIndex;
