const Datastore = require('nedb');
const path = require('path');

function clearDatastore(dbPath, dbName) {
    const db = new Datastore({ filename: dbPath, autoload: true });

    // Attempt to remove all entries
    db.remove({}, { multi: true }, (err, numRemoved) => {
        if (err) {
            console.error(`Error clearing the ${dbName} database:`, err);
            // Fallback: Remove each entry individually
            db.find({}, (findErr, entries) => {
                if (findErr) {
                    console.error(`Error finding entries in the ${dbName} database:`, findErr);
                    return;
                }
                entries.forEach(entry => {
                    db.remove({ _id: entry._id }, {}, (removeErr) => {
                        if (removeErr) {
                            console.error(`Error removing entry from the ${dbName} database:`, removeErr);
                        }
                    });
                });
            });
        } else {
            console.log(`Cleared ${numRemoved} entries from the ${dbName} database.`);
            // Explicitly reload the database
            db.loadDatabase(loadErr => {
                if (loadErr) {
                    console.error(`Error reloading the ${dbName} database:`, loadErr);
                }
            });
        }
    });
}


// Define paths to your NeDB database files
const txIndexDbPath = path.join(__dirname, 'nedb-data', 'txIndex.db');
const propertyListDbPath = path.join(__dirname, 'nedb-data', 'propertyList.db');
const tallyMapDbPath = path.join(__dirname, 'nedb-data', 'tallyMap.db');
const activationsDbPath = path.join(__dirname, 'nedb-data', 'activations.db');
const consensusDbPath = path.join(__dirname, 'nedb-data', 'consensus.db'); // Path to consensus.db

// Clear entries from each database
clearDatastore(txIndexDbPath, 'txIndex');
clearDatastore(propertyListDbPath, 'propertyList');
clearDatastore(tallyMapDbPath, 'tallyMap');
clearDatastore(activationsDbPath, 'activations');
clearDatastore(consensusDbPath, 'consensus'); // Clear the consensus database
