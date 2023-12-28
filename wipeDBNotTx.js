const Datastore = require('nedb');
const path = require('path');

function clearDatastore(dbPath, dbName) {
    const db = new Datastore({ filename: dbPath, autoload: true });

    db.remove({}, { multi: true }, (err, numRemoved) => {
        if (err) {
            console.error(`Error clearing the ${dbName} database:`, err);
        } else {
            console.log(`Cleared ${numRemoved} entries from the ${dbName} database.`);
            db.loadDatabase(loadErr => {
                if (loadErr) {
                    console.error(`Error reloading the ${dbName} database:`, loadErr);
                }
            });
        }
    });
}

// Define paths to your NeDB database files
const propertyListDbPath = path.join(__dirname, 'nedb-data', 'propertyList.db');
const tallyMapDbPath = path.join(__dirname, 'nedb-data', 'tallyMap.db');
const activationsDbPath = path.join(__dirname, 'nedb-data', 'activations.db');
const consensusDbPath = path.join(__dirname, 'nedb-data', 'consensus.db');
const orderBooksDbPath = path.join(__dirname, 'nedb-data', 'orderBooks.db');
const insuranceDbPath = path.join(__dirname, 'nedb-data', 'insurance.db');
const oracleListDbPath = path.join(__dirname, 'nedb-data', 'oracleList.db'); // Path to oracleList.db
const contractListDbPath = path.join(__dirname, 'nedb-data', 'contractList.db')

// Clear entries from each database
clearDatastore(propertyListDbPath, 'propertyList');
clearDatastore(tallyMapDbPath, 'tallyMap');
clearDatastore(activationsDbPath, 'activations');
clearDatastore(consensusDbPath, 'consensus');
clearDatastore(orderBooksDbPath, 'orderBooks');
clearDatastore(insuranceDbPath, 'insurance');
clearDatastore(oracleListDbPath, 'oracleList'); // Clear the oracleList database
clearDatastore(contractListDbPath, 'contractList')