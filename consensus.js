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
        const result = await db.getDatabase('consensus').findOneAsync({ _id: txId });
        return !!result;
    }

    static async markTxAsProcessed(txId) {
        await db.getDatabase('consensus').insertAsync({ _id: txId, processed: true });
    }
}

module.exports = ConsensusDatabase;

