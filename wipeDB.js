const Datastore = require('nedb');
const path = require('path');

// Helper function to clear a specific datastore
function clearDatastore(dbPath, dbName) {
    const db = new Datastore({ filename: dbPath, autoload: true });
    db.remove({}, { multi: true }, (err, numRemoved) => {
        if (err) {
            console.error(`Error clearing the ${dbName} database:`, err);
        } else {
            console.log(`Cleared ${numRemoved} entries from the ${dbName} database.`);
        }
    });
}

// Define paths to your NeDB database files
const txIndexDbPath = path.join(__dirname, 'nedb-data', 'txIndex.db');
const propertyListDbPath = path.join(__dirname, 'nedb-data', 'propertyList.db');
const tallyMapDbPath = path.join(__dirname, 'nedb-data', 'tallyMap.db');
const activationsDbPath = path.join(__dirname, 'nedb-data', 'activations.db');

// Clear entries from each database
clearDatastore(txIndexDbPath, 'txIndex');
clearDatastore(propertyListDbPath, 'propertyList');
clearDatastore(tallyMapDbPath, 'tallyMap');
clearDatastore(activationsDbPath, 'activations')
