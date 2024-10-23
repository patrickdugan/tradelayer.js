const crypto = require('crypto');
const db = require('../src/db.js'); // Assuming db.js is correctly set up
const client = require('../src/client.js').getInstance()

class ConsensusDatabase {
    // Function to generate SHA-256 hash
    static generateHash(input) {
        const hash = crypto.createHash('sha256');
        hash.update(input);
        return hash.digest('hex');
    }

    // Function to get the latest instance of a DB
    static async getLatestInstance(dbName) {
        const base = await db.getDatabase(dbName)
        const data = await base.findAsync({});
        return data.length > 0 ? data[data.length - 1] : null; // Get the latest entry
    }

    // Function to get all instances from a DB
    static async getAllInstances(dbName) {
        const base = await db.getDatabase(dbName)
        const data = await base.findAsync({});
        return data; // Return all entries
    }

    // Function to generate stateConsensusHash based on various DBs
    static async stateConsensusHash() {
        try {
            // Retrieve latest instance from tally.db and activations.db
            const latestTally = await this.getLatestInstance('tallyMap');
            const latestActivation = await this.getLatestInstance('activations');

            // Retrieve everything from other specified DBs
            const channels = await this.getAllInstances('channels');
            const clearlists = await this.getAllInstances('clearlists');
            const contractList = await this.getAllInstances('contractList');
            const feeCache = await this.getAllInstances('feeCache');
            const insurance = await this.getAllInstances('insurance');
            const marginMaps = await this.getAllInstances('marginMaps');
            const oracleData = await this.getAllInstances('oracleData');
            const oracleList = await this.getAllInstances('oracleList');
            const orderBooks = await this.getAllInstances('orderBooks');
            const propertyList = await this.getAllInstances('propertyList');
            const syntheticTokens = await this.getAllInstances('syntheticTokens');
            const vaults = await this.getAllInstances('vaults');
            const volumeIndex = await this.getAllInstances('volumeIndex');
            const withdrawQueue = await this.getAllInstances('withdrawQueue');

            // Combine all the retrieved data into a single structure
            const combinedState = {
                latestTally,
                latestActivation,
                channels,
                clearlists,
                contractList,
                feeCache,
                insurance,
                marginMaps,
                oracleData,
                oracleList,
                orderBooks,
                propertyList,
                syntheticTokens,
                vaults,
                volumeIndex,
                withdrawQueue
            };

            // Convert combined data to string
            const combinedStateString = JSON.stringify(combinedState);

            // Generate and return the SHA-256 hash of the combined state
            const hash = this.generateHash(combinedStateString);
            console.log('stateConsensusHash:', hash);
            return hash;

        } catch (err) {
            console.error('Error generating stateConsensus hash:', err);
        }
    }
}

// Test the stateConsensusHash function
(async () => {
    
    await db.init('ltc')
    console.log('Generating stateConsensusHash...');
    const stateHash = await ConsensusDatabase.stateConsensusHash();
    console.log('Generated stateConsensusHash:', stateHash);
})();
