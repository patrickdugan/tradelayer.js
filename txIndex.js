const litecoin = require('litecoin');
const json = require('big-json');
const util = require('util');
const txUtils = require('./txUtils');
const Types = require('./types.js');
const { txIndexDB } = require('./db.js');

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

    static getInstance(test) {
        if (!TxIndex.instance) {
            TxIndex.instance = new TxIndex(test);
        }
        return TxIndex.instance;
    }

    static async initializeIndex(genesisBlock) {
        await txIndexDB.put('genesisBlock', genesisBlock);
        await txIndexDB.put('indexExists', true);
        await TxIndex.getInstance().extractBlockData(genesisBlock);
    }

    async extractBlockData(startHeight) {
        let chainTip = await this.fetchChainTip();
        for (let height = startHeight; height <= chainTip; height++) {
            let blockData = await this.fetchBlockData(height);
            await this.processBlockData(blockData, height);
            chainTip = await this.fetchChainTip();
        }
        console.log('indexed to chaintip');
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
            
            if(txData != null){
                if (txData.marker === 'tl') {
                    this.transparentIndex.push(txData.payload);
                    const txDetails = await this.processTransaction(txData.payload, txData.decodedTx, txId, txData.marker);
                    await this.saveTransactionData(txId, txData.decodedTx, txData.payload, blockHeight, txDetails);
                    console.log(txDetails);
                    await this.saveTransactionByHeight(txId, blockHeight);
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
            // Process decoded transaction logic here...
            return decodedTx;
        } catch (error) {
            console.error('Error decoding raw transaction:', error);
        }
    }

    async processTransaction(payload, decodedTx, txId, marker) {
        // Process the transaction...
        const sender = await txUtils.getSender(txId);
        const reference = await txUtils.getReference(txId);
        const decodedParams = Types.decodePayload(txId, marker, payload);
        return { sender, reference, payload, decodedParams };
    }

    static async saveTransactionByHeight(txId, blockHeight) {
        try {
            const txKey = `txHeight-${blockHeight}-${txId}`;
            const instance = TxIndex.getInstance();
            const txData = await instance.fetchTransactionData(txId);
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

    static async saveTransactionData(txId, txData, payload, blockHeight) {
        const indexKey = `tx-${blockHeight}-${txId}`;
        await txIndexDB.put(indexKey, JSON.stringify({ txData, payload }));
    }

    static async loadIndex() {
        return new Promise((resolve, reject) => {
            let data = {};
            txIndexDB.createReadStream()
                .on('data', (entry) => {
                    data[entry.key] = entry.value;
                })
                .on('error', (err) => {
                    console.error('Stream encountered an error:', err);
                    reject(err);
                })
                .on('end', () => {
                    console.log('Stream ended');
                    resolve(data);
                });
        });
    }

    static async clearTxIndex() {
        try {
            await txIndexDB.clear();
            console.log('txIndexDB cleared successfully.');
        } catch (error) {
            console.error('Error in clearing txIndexDB:', error);
        }
    }
}

module.exports = TxIndex;
