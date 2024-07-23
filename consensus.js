const db = require('./db.js');
const path = require('path');
const util = require('util');

class ConsensusDatabase {
    constructor() {
        if (ConsensusDatabase.instance) {
            return ConsensusDatabase.instance;
        }

        ConsensusDatabase.instance = this;
    }

    static async storeConsensusHash(blockHeight, consensusHash) {
        const doc = { blockHeight, consensusHash };
        try {
            await db.getDatabase('consensus').insertAsync(doc);
            console.log(`Consensus hash for block ${blockHeight} stored.`);
        } catch (err) {
            console.error('Error storing consensus hash:', err);
        }
    }

    static async getConsensusHash(blockHeight) {
            try {
                const docs = await db.getDatabase('consensus').findAsync({ blockHeight });
                if (docs.length > 0) {
                    return docs[0].consensusHash;
                } else {
                    return null;
                }
            } catch (err) {
                console.error('Error retrieving consensus hash:', err);
                return null;
            }
    }

    static async checkIfTxProcessed(txId) {
        //console.log('inside checkIfTxProcessed ' + txId);
        const result = await db.getDatabase('consensus').findOneAsync({ _id: txId });
        //console.log(result);
        return result && result.processed === true;
    }

    static async getTxParams(txId) {
        const result = await db.getDatabase('consensus').findOneAsync({ _id: txId });
        return result.value.processed === true ? result.value.params : null;
    }

    static async markTxAsProcessed(txId, params) {
        let value = { processed: true, params };
        await db.getDatabase('consensus').updateAsync(
            { _id: txId },
            { $set: value },
            { upsert: true }
        );
    }

    static async getTxParamsForAddress(address) {
        const results = await db.getDatabase('consensus').findAsync({ "value.processed": true, "value.params.address": address });
        return results.map(result => result.value.params);
    }

    static async getTxParamsForBlock(blockHeight) {
        const results = await db.getDatabase('consensus').findAsync({ "value.processed": true, "value.params.block": blockHeight });
        return results.map(result => result.value.params);
    }

    static async getMaxProcessedBlock() {
        const result = await db.getDatabase('consensus').findOneAsync({ _id: 'MaxProcessedHeight' });
        return result ? result.value : null;
    }

    static async getHighestBlockHeight(callback) {
        db.getDatabase('consensus').aggregate([
            { $group: { _id: null, maxBlockHeight: { $max: "$value.params.blockHeight" } } }
        ], (err, result) => {
            if (err) {
                callback(err, null);
            } else {
                const maxBlockHeight = result.length > 0 ? result[0].maxBlockHeight : null;
                callback(null, maxBlockHeight);
            }
        });
    }


    static async compareBlockHeights() {
        const maxProcessedBlock = await this.getMaxProcessedBlock();
        const highestBlockHeight = await this.getHighestBlockHeight();

        const higherBlockHeight = Math.max(maxProcessedBlock, highestBlockHeight);

        return {
            maxProcessedBlock,
            highestBlockHeight,
            higherBlockHeight
        };
    }

}

module.exports = ConsensusDatabase;

