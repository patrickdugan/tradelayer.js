const { dbFactory } = require('./db.js')

class Consensus {
    constructor(db) {
        this.db = db;
    }

    async storeConsensusHash(blockHeight, consensusHash) {
        try {
            await this.db.insertAsync({ blockHeight, consensusHash })
            console.log(`Consensus hash for block ${blockHeight} stored.`)
        } catch (err) {
            console.error('Error storing consensus hash:', err)
        }
    }

    async getConsensusHash(blockHeight) {
        try {
            const docs = await this.db.findAsync({ blockHeight })
            if (docs?.length > 0) {
                return docs[0].consensusHash;
            }
        } catch (err) {
            console.error('Error retrieving consensus hash:', err)
        }
        return null;
    }

    async checkIfTxProcessed(txId) {
        const tx = await this.db.findOneAsync({ _id: txId })
        return !!tx;
    }

    async markTxAsProcessed(txId) {
        await this.db.insertAsync({ _id: txId, processed: true })
    }

    async getMaxProcessedHeight() {
        const d = await this.db.findOneAsync({ _id: 'MaxProcessedHeight' });
        return Number.isInteger(d?.value) ? d.value : 0
    }

    async updateMaxProcessedHeight(maxProcessedHeight) {
        await this.db.updateAsync(
            { _id: 'MaxProcessedHeight' },
            { $set: { value: maxProcessedHeight } },
            { upsert: true }
        )
    }
}

exports.tlConsensus = new Consensus(dbFactory.getDatabase('consensus'))
