const litecoin = require('litecoin');
const json = require('big-json');
const util = require('util');
const txUtils = require('./txUtils');
const Types = require('./types.js');
const db = require('./db'); // Assuming db.js exports the singleton instance

class TxIndex {
    static instance;

    constructor(test) {
        if (TxIndex.instance) {
            return TxIndex.instance;
        }

        const clientConfig = /*test ?*/ {
            host: '127.0.0.1',
            port: 18332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        } /*: {
            host: '127.0.0.1',
            port: 8332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        };*/

        this.client = new litecoin.Client(clientConfig);
        this.decoderawtransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'decoderawtransaction'));
        this.getTransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'gettransaction'));
        this.transparentIndex = [];

        TxIndex.instance = this;
    }

    static getInstance(test) {
        if (!TxIndex.instance) {
            TxIndex.instance = new TxIndex(test);
        }
        return TxIndex.instance;
    }

    static async initializeIndex(genesisBlock) {
        await db.put('txIndex', 'genesisBlock', genesisBlock);
        await TxIndex.getInstance().extractBlockData(genesisBlock);
    }
    async extractBlockData(startHeight) {
        let chainTip = await this.fetchChainTip();
        console.log('building index until'+chainTip)
        for (let height = startHeight; height <= chainTip; height++) {
            console.log(height)
            let blockData = await this.fetchBlockData(height);
            console.log(blockData)
            await this.processBlockData(blockData, height);
            chainTip = await this.fetchChainTip();
        }
        console.log('indexed to chaintip');
        await txIndexDB.put('indexExists', true);
        return console.log('built index')
    }

    async fetchChainTip() {
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

    async fetchBlockData(height) {
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

    async processBlockData(blockData, blockHeight) {
        for (const txId of blockData.tx) {
            const txHex = await this.fetchTransactionData(txId);   
            const txData = await this.DecodeRawTransaction(txHex);
            //console.log(txData)
            if(txData != null){
                //console.log(txData.marker)
                if (txData.marker === 'tl') {
                    console.log(txData.payload)
                    this.transparentIndex.push(txData.payload);
                    const txDetails = await this.processTransaction(txData.payload, txData.decodedTx, txId, txData.marker);
                    //await this.saveTransactionData(txId, txData.decodedTx, txData.payload, blockHeight, txDetails);
                    console.log(txDetails);
                }
            }
        }
    }

    async fetchTransactionData(txId) {
        return new Promise((resolve, reject) => {
            this.client.getRawTransaction(txId, true, (error, transaction) => {
                if (error) {
                    console.log(error);
                    reject(error);
                } else {
                    resolve(transaction.hex);
                }
            });
        });
    }

     async DecodeRawTransaction(rawTx) {
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
            // Process decoded transaction logic here...
            return decodedTx;
        } catch (error) {
            //console.error('Error decoding raw transaction:', error);
        }
    }

    async processTransaction(payload, decodedTx, txId, marker) {
        // Process the transaction...
        const sender = await txUtils.getSender(txId);
        const reference = await txUtils.getReference(txId);
        const decodedParams = Types.decodePayload(txId, marker, payload);
        return { sender, reference, payload, decodedParams };
    }

    async saveTransactionData(txId, txData, payload, blockHeight) {
        const indexKey = `tx-${blockHeight}-${txId}`;
        await db.put('txIndex', indexKey, JSON.stringify({ txData, payload }));
    }

     async loadIndex() {
        const data = {};
        try {
            const stream = db.db.createReadStream({
                gte: 'txIndex:',
                lte: 'txIndex:\xff'
            });

            for await (const { key, value } of stream) {
                // Removing the 'txIndex:' prefix from the key for the returned data object
                const formattedKey = key.split(':')[1];
                data[formattedKey] = value;
            }

            console.log('Index loaded successfully.');
            return data;
        } catch (err) {
            console.error('Error loading index:', err);
            throw err;
        }
    }


    static async clearTxIndex() {
        // Iterate over keys in the txIndex category and delete them
        return new Promise(async (resolve, reject) => {
            try {
                const stream = db.db.createKeyStream({
                    gte: 'txIndex:',
                    lte: 'txIndex:\xff'
                });

                for await (const key of stream) {
                    await db.delete('txIndex', key.split(':')[1]);
                }

                console.log('txIndexDB cleared successfully.');
                resolve();
            } catch (error) {
                console.error('Error in clearing txIndexDB:', error);
                reject(error);
            }
        });
    }

    async initializeOrLoadDB(genesisBlock) {
        try {
            const genesis = await db.get('txIndex', 'genesisBlock');
            if (genesis === null) {
                console.log('Initializing database with genesis block:', genesisBlock);
                await db.put('txIndex', 'genesisBlock', genesisBlock);
            } else {
                console.log('Database already initialized. Genesis block:', genesis);
            }
        } catch (error) {
            console.error('Error accessing database:', error);
        }
    }

    static async resetIndexFlag() {
        await db.delete('txIndex', 'indexExists');
        await db.delete('txIndex', 'genesisBlock');
        console.log('Index flags reset successfully.');
    }

    static async findMaxIndexedBlock() {
        let maxBlockHeight = 0;
        const stream = db.db.createReadStream({
            gte: 'txIndex:tx-',
            lte: 'txIndex:tx-\xff'
        });

        for await (const { key } of stream) {
            const height = parseInt(key.split('-')[1]);
            if (height > maxBlockHeight) {
                maxBlockHeight = height;
            }
        }

        // Optionally save the max block height in the database if needed
        await db.put('txIndex', 'maxIndexHeight', maxBlockHeight);

        return maxBlockHeight;
    }

   static async checkForIndex() {
        try {
            const indexExistsValue = await db.get('txIndex', 'indexExists');
            return indexExistsValue !== undefined;
        } catch (error) {
            if (error.type === 'NotFoundError' || error.notFound) {
                // Key does not exist, which means the index has not been created yet
                return false;
            } else {
                // Some other error occurred
                console.error('Error checking for index:', error);
                throw error; // Rethrow the error to handle it in the calling context
            }
        }
    }

}

module.exports = TxIndex;
