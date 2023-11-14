const litecoin = require('litecoin');
const level = require('level');
const json = require('big-json');

class TxIndex {
    constructor() {
        this.db = level('./txIndexDB');
        this.client = new litecoin.Client({
            host: '127.0.0.1',
            port: 8332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        });
    }

    async initializeIndex(genesisBlock) {
        await this.db.put('genesisBlock', genesisBlock);
    }

    async extractBlockData(startHeight) {
        const chainTip = await this.fetchChainTip();
        for (let height = startHeight; height <= chainTip; height++) {
            const blockData = await this.fetchBlockData(height);
            await this.processBlockData(blockData, height);
        }
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
            const txData = await this.fetchTransactionData(txId);
            const txType = this.decodeTransactionType(txData);
            if (txType === 'tl') {
                await this.saveTransactionData(txId, txData, txType, blockHeight);
            }
        }
    }

    async fetchTransactionData(txId) {
        return new Promise((resolve, reject) => {
            this.client.getRawTransaction(txId, 1, (error, transaction) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(transaction);
                }
            });
        });
    }

    decodeTransactionType(txData) {
        // Assuming OP_RETURN is used for TL transactions
        const opReturn = txData.vout.find(vout => vout.scriptPubKey.type === "nulldata");
        if (!opReturn) return null;

        const hexPayload = opReturn.scriptPubKey.hex;
        return this.decodePayload(hexPayload);
    }

    decodePayload(hexPayload) {
        const marker = hexPayload.slice(0, 1);
        if (marker === '746c'||marker==="tl"){
            return "tl";
        } else {
            return null;
        }
    }

    async saveTransactionData(txId, txData, txType, blockHeight) {
        await this.db.put(`tx-${blockHeight}-${txId}`, JSON.stringify({ txData, txType }));
    }

    async loadIndex() {
        // Load and process the saved index from LevelDB
        // This method will depend on how you want to utilize the loaded data
        return {}; // Placeholder
    }
}

module.exports = TxIndex;
