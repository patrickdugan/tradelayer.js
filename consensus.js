const Datastore = require('nedb');
const path = require('path');
const util = require('util');

class ConsensusDatabase {
    constructor() {
        if (ConsensusDatabase.instance) {
            return ConsensusDatabase.instance;
        }

        this.consensusDB = new Datastore({ 
            filename: path.join(__dirname, 'nedb-data/consensus.db'), 
            autoload: true 
        });

        // Promisify NeDB methods
        this.consensusDB.findAsync = util.promisify(this.consensusDB.find.bind(this.consensusDB));
        this.consensusDB.insertAsync = util.promisify(this.consensusDB.insert.bind(this.consensusDB));

        ConsensusDatabase.instance = this;
    }

    async storeConsensusHash(blockHeight, consensusHash) {
        const doc = { blockHeight, consensusHash };
        try {
            await this.consensusDB.insertAsync(doc);
            console.log(`Consensus hash for block ${blockHeight} stored.`);
        } catch (err) {
            console.error('Error storing consensus hash:', err);
        }
    }

    async getConsensusHash(blockHeight) {
            try {
                const docs = await this.consensusDB.findAsync({ blockHeight });
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
}

module.exports = ConsensusDatabase;

