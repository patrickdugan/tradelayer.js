// test-txIndexHash.js

const crypto = require('crypto');
const db = require('./db.js');  // Import the actual db.js file

// ConsensusDatabase class
class ConsensusDatabase {
    // Function to generate SHA-256 hash
    static generateHash(input) {
        const hash = crypto.createHash('sha256');
        hash.update(input);
        return hash.digest('hex');
    }

    // 1. txIndexHash: Hash the filtered txIndex
    static async txIndexHash() {
        try {
            const txIndex = await db.getDatabase('txIndex').findAsync({});
            const filteredTxIndex = txIndex.filter(tx => tx._id.startsWith('tx'));
            const filteredTxIndexString = JSON.stringify(filteredTxIndex);
            const hash = this.generateHash(filteredTxIndexString);
            console.log('txIndexHash:', hash);
            return hash;
        } catch (err) {
            console.error('Error generating txIndex hash:', err);
        }
    }
}

// Run the test
(async () => {
    console.log('Running txIndexHash test...');
    const result = await ConsensusDatabase.txIndexHash();
    console.log('Test result:', result);
})();
