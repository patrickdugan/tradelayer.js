const Datastore = require('nedb');
const util = require('util');
const path = require('path');

// Initialize the NeDB database
const dbPath = path.join(__dirname, 'nedb-data');
const txIndexDB = new Datastore({ filename: path.join(dbPath, 'txIndex.db'), autoload: true });

// Promisify the NeDB methods
txIndexDB.updateAsync = util.promisify(txIndexDB.update.bind(txIndexDB));

async function updateMaxHeight(chainTip) {
    try {
        console.log(`Updating MaxHeight to ${chainTip}`);
        await txIndexDB.updateAsync(
            { _id: 'MaxHeight' },
            { _id: 'MaxHeight', value: chainTip },
            { upsert: true }
        );
        console.log('MaxHeight updated successfully.');
    } catch (error) {
        console.error('Error updating MaxHeight:', error);
        throw error;
    }
}

// Example usage of the test function
const chainTip = 1000; // Replace with the actual chain tip value you want to test
updateMaxHeight(chainTip)
    .then(() => console.log('Test completed successfully'))
    .catch(err => console.error('Test failed:', err));
