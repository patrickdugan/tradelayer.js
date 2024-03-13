const db = require('./db.js');

class ConsensusDatabase {

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
        return result && result.value && result.value.processed === true;
    }

    static async getTxParams(txId) {
        const result = await db.getDatabase('consensus').findOneAsync({ _id: txId });
        return result.value?.processed === true ? result.value?.params : {};
    }

    static async markTxAsProcessed(txId, params) {
        value = {processed: true, params}
        await db.getDatabase('consensus').insertAsync({ _id: txId, value });
    }

    static async getTxParamsForAddress(address) {
        const entries = await db.getDatabase('consensus').findAsync({ "value.processed": true, "value.params.address": address });
        return entries.map(e=>({
            txid: e.value.params.txid,
            block: e.value.params.block,
            amounts: e.value.params.amounts,
            reason: e.value.params.reason,
        }));
    }

    static async getTxParamsForBlock(blockHeight) {
        const entries = await db.getDatabase('consensus').findAsync({ "value.processed": true, "value.params.block": blockHeight });
        return entries.map(e=>({
            txid: e.value.params.txid,
            block: e.value.params.block,
            amounts: e.value.params.amounts,
            reason: e.value.params.reason,
        }));
    }

    static async getInvalidated() {
        const entries = await db.getDatabase('consensus').findAsync({ 'value.params.valid' :false });
        return entries.map(e=>({
            txid: e.value.params.txid,
            block: e.value.params.block,
            amounts: e.value.params.amounts,
            reason: e.value.params.reason,
        }));
    }

    static async getTop10Blocks() {
        const entries = await db.getDatabase('consensus').findAsync({ "value.processed": true, "value.params.block": {$exists: true} });
        return Array.from(entries.map(e=>e.value.params.block)).sort((a,b)=>a>b);
    }
}

module.exports = ConsensusDatabase;
