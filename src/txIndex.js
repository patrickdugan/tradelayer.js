
const json = require('big-json');
const util = require('util');
const TxUtils = require('./txUtils');
//const Types = require('./types.js');
const db = require('./db.js');
const ClientWrapper = require('./client.js'); // Wait for client to initialize//console.log('this.client in TxId'+this.client)
const transparentIndex = [];

class TxIndex {
     static instance;

    constructor() {
        if (TxIndex.instance) {
            return TxIndex.instance;
        }
        TxIndex.instance = this;
    }

    static async init() {
        this.client = await ClientWrapper.getInstance();
        // Use this.this.client for this.client-related actions within TxIndex methods
    }

    static async getInstance(test) {
        if (!TxIndex.instance) {
            TxIndex.instance = new TxIndex(test);
        }
        await this.init()
        return TxIndex.instance;
    }

    static async initializeIndex(genesisBlock) {
             try {
            const base = await db.getDatabase('txIndex')
            const existingGenesisBlock = await base.findOneAsync({ _id: 'genesisBlock' });
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
            await base.insertAsync({ _id: 'genesisBlock', value: genesisBlock });
            console.log('Genesis block initialized:', genesisBlock);
        } catch (error) {
            // Handle any errors that occur during insertion
            console.error('Error initializing genesis block:', error);
            throw error;
        }
    }

    static async extractBlockData(startHeight) {
        let chainTip = await this.fetchChainTip();
        console.log('building index until' + chainTip);
        for (let height = startHeight; height <= chainTip; height++) {
            if(height%1000==1){console.log('indexed to '+height)};
            let blockData = await this.fetchBlockData(height);
            //console.log(blockData)
            await this.processBlockData(blockData, height);
            //chainTip = await this.fetchChainTip();
        }
        console.log('indexed to chaintip');
        this.saveMaxHeight(chainTip)
                console.log('built index');
    }

    static async saveMaxHeight(chainTip){
        // Use the correct NeDB method to insert or update the 'indexExists' document
         // After processing the block, update 'MaxHeight'
         //console.log('saving MaxHeight '+chainTip)
         if(chainTip==undefined||chainTip==null){
            //console.log('no value to save, returning from saveMaxHeight ')
            return
         }

            const base = await db.getDatabase('txIndex')
            await base.updateAsync(
                { _id: 'MaxHeight' }, // Query
                { $set: { value: chainTip } }, // Update
                { upsert: true } // Options
            );

            try {
                await base.updateAsync(
                    { _id: 'indexExists' },
                    { _id: 'indexExists', value: true },
                    { upsert: true } // This option ensures that the document is inserted if it doesn't exist or updated if it does.
                );
                //console.log('Index flag set successfully.');
            } catch (error) {
                console.error('Error setting the index flag:', error);
                throw error;
            }
    }

    static async fetchChainTip() {
        try {
            const chainTip = await this.client.getBlockCount();
            return chainTip;
        } catch (error) {
            throw new Error(`Error fetching chain tip: ${error}`);
        }
    }


    static async fetchBlockData(height) {
        try {
            // Fetch the block hash for the given height
            const blockHash = await this.client.getBlockHash(height);
            // Fetch the block data using the retrieved block hash
            const block = await this.client.getBlock(blockHash);
            return block;
        } catch (error) {
            console.error(`Error fetching block data for height ${height}:`, error);
            throw error;
        }
    }


    static async processBlockData(blockData, blockHeight) {
            const txIndexDB = await db.getDatabase('txIndex');
            //console.log(blockData)
            let txDetails =[]
        for(const txId of blockData.tx){
            //console.log(txId)
            const txHex = await TxIndex.fetchTransactionData(txId, false, blockData.hash);
            //console.log(txHex)
            const txData = await TxIndex.DecodeRawTransaction(txHex);
            //console.log('tx data' +txData)
            if (txData != null && txData!= undefined && txData.marker === 'tl') {
                const payload = txData.payload;
                const thisTx = await TxIndex.processTransaction(payload, txId, txData.marker);
                txDetails.push(thisTx)
                console.log('payload '+payload+JSON.stringify(txDetails))

               try {
                    await txIndexDB.insertAsync({ _id: `tx-${blockHeight}-${txId}`, value: txDetails });
                } catch (dbError) {
                    console.error(`Error inserting transaction data for txId ${txId} at blockHeight ${blockHeight}:`, dbError);
                }
                  await this.saveMaxHeight(blockHeight)   
            }
        }
         
        return txDetails
    }
    
    static async fetchTransactionData(txId, verbose, blockHash) {
        try {
            const transaction = await this.client.getRawTransaction(txId,verbose,blockHash);
            return transaction;
        } catch (error) {
            console.error('Error fetching transaction:', error);
            throw error;
        }
    }


    /*static async DecodeRawTransaction(rawTx) {
        try {
            const decodedTx = await this.client.decoderawtransaction(rawTx);
            const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

            if (opReturnOutput) {
                const opReturnData = opReturnOutput.scriptPubKey.hex;
                // Decode the entire hex string
                const decodedData = Buffer.from(opReturnData, 'hex').toString();

                // Search for "tl" in the decoded string
                const markerIndex = decodedData.indexOf('tl');
                if (markerIndex !== -1) {
                console.log('decoded total payload '+decodedData)
                    // Extract everything after "tl" as the payload
                    const payload = decodedData.substring(markerIndex + 2);
                    console.log('Decoded Payload:', payload);
                    return { marker: 'tl', payload, decodedTx };
                } else {
                    //console.error('No "tl" marker found.');
                    return null;
                }
            } else {
                //console.error('No OP_RETURN output found.');
                return null;
            }
        } catch (error) {
            console.error('Error decoding raw transaction:', error);
        }
    }*/

    static async DecodeRawTransaction(rawTx) {
        try {
            const decodedTx = await this.client.decoderawtransaction(rawTx);
            

            const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

            if (opReturnOutput) {
                //console.log(opReturnOutput)
                const opReturnData = opReturnOutput.scriptPubKey.hex;
                //console.log('OP_RETURN Data:', opReturnData);
                // Extract and log the "tl" marker

                 // Check if the hex contains the marker "746c" (which corresponds to "tl")
                let markerHex = "746c"; // Hex for "tl"
                let payloadStart =8
                let markerPosition = opReturnData.indexOf(markerHex); // Check if the marker is anywhere in the string
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


    static async processTransaction(payload, txId, marker) {
        const Types = require('./Types.js'); // Lazy load Types
        // Process the transaction...
        const sender = await TxUtils.getSender(txId);
        const reference = await TxUtils.getReference(txId);
        const decodedParams = Types.decodePayload(txId, marker, payload);
        return { sender, reference, payload, decodedParams, marker, txId};
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
            const base = await db.getDatabase('txIndex')
            const existingDocument = await base.findOneAsync({ _id: indexKey });

            if (existingDocument) {
                // Document exists, perform an update
                const update = { $set: { txData, payload } };
                await base.updateAsync({ _id: indexKey }, update);
                //console.log(`Transaction data updated for ${indexKey}`);
            } else {
                // Document does not exist, perform an insert
                await base.insertAsync(document);
                //console.log(`Transaction data inserted for ${indexKey}`);
            }
        } catch (error) {
            // Handle any errors
            console.error(`Error saving transaction data for ${indexKey}: ${error}`);
        }
    }



     async loadIndex() {
            try {
                const data = {};
                const base = await db.getDatabase('txIndex')
                const entries = await base.findAsync({});
                
                entries.forEach(entry => {
                    data[entry._id] = entry.value;
                });
                
                return data;
            } catch (err) {
                console.error('Error loading index:', err);
                throw err;
            }
        }

    static async upsertTxValidityAndReason(txId, type, isValid, reason) {
            
            // Fetch all entries with _id starting with "tx"
            const base = await db.getDatabase('txIndex')
            const allTxData = await base.findAsync({ _id: { $regex: /^tx/ } });
            
            // Filter for the entry ending with the specified txId
            const txData = allTxData.find(txData => txData._id.endsWith(`-${txId}`));
            
            // If the entry is found, update it; otherwise, create a new one
            if (txData) {
                await base.updateAsync(
                    { _id: txData._id },
                    { $set: { type: type, valid: isValid, reason: reason } },
                    { upsert: true }
                );
                //console.log(`Transaction ${txData._id} validity updated in txIndex.`);
            } else {
                console.error(`No entry found for transaction ${txId} in txIndex.`);
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
                const txIndexDB = await db.getDatabase('txIndex');

                // Attempt to find the 'genesisBlock' key
                await txIndexDB.findOneAsync({ _id: 'genesisBlock' })
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
            const txIndexDB = await db.getDatabase('txIndex')
           const maxHeightDoc = await txIndexDB.findOneAsync({ _id: 'MaxHeight' });

            if (maxHeightDoc) {
                return maxHeightDoc.value;
            } else {
                // Handle the case where MaxHeight hasn't been set yet
                //console.log('MaxHeight not found in txIndexDB.');
                return 3082500; // or an appropriate default/fallback value
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
            const blockHeight = await TxIndex.fetchChainTip()
            const txData = await db.getDatabase('txIndex').findOneAsync({ _id: indexKey });

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
            const txIndexDB = await db.getDatabase('txIndex');
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