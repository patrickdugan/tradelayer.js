const Datastore = require('nedb');
const path = require('path');
const dbFolderName = "nedb-data";

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
const propertyListDbPath = path.join(dbFolderName, 'propertyList.db');
const tallyMapDbPath = path.join(dbFolderName, 'tallyMap.db');
const activationsDbPath = path.join(dbFolderName, 'activations.db');
const consensusDbPath = path.join(dbFolderName, 'consensus.db');
const orderBooksDbPath = path.join(dbFolderName, 'orderBooks.db');
const insuranceDbPath = path.join(dbFolderName, 'insurance.db');
const oracleListDbPath = path.join(dbFolderName, 'oracleList.db'); // Path to oracleList.db
const contractListDbPath = path.join(dbFolderName, 'contractList.db')
const tradeHistoryDbPath = path.join(dbFolderName, 'tradeHistory.db')
const oracleDataDbPath = path.join(dbFolderName, 'oracleData.db');
const marginMapDbPath = path.join(dbFolderName, 'marginMaps.db')
const tallyMapDeltasDbPath = path.join(dbFolderName, 'tallyMapDelta.db')
const marginMapDeltasDbPath = path.join(dbFolderName, 'marginMapDelta.db')
const channelsDbPath = path.join(dbFolderName,'channels.db')
const withdrawalQueueDbPath = path.join(dbFolderName,'withdrawalQueue.db')
const liquidationsDbPath = path.join(dbFolderName,'liquidations.db')
const feeCacheDbPath = path.join(dbFolderName,'feeCache.db')

// Clear entries from each database
clearDatastore(propertyListDbPath, 'propertyList');
clearDatastore(tallyMapDbPath, 'tallyMap');
clearDatastore(activationsDbPath, 'activations');
clearDatastore(consensusDbPath, 'consensus');
clearDatastore(orderBooksDbPath, 'orderBooks');
clearDatastore(insuranceDbPath, 'insurance');
clearDatastore(oracleListDbPath, 'oracleList'); // Clear the oracleList database
clearDatastore(contractListDbPath, 'contractList')
clearDatastore(tradeHistoryDbPath, 'tradeHistory')
clearDatastore(oracleDataDbPath, 'oracleData')
clearDatastore(marginMapDbPath, 'marginMaps')
clearDatastore(tallyMapDeltasDbPath, 'tallyMapDelta')
clearDatastore(marginMapDeltasDbPath, 'marginMapDelta')
clearDatastore(channelsDbPath, 'channels')
clearDatastore(withdrawalQueueDbPath, 'withdrawalQueue')
clearDatastore(liquidationsDbPath, 'liquidations')
clearDatastore(feeCacheDbPath, 'feeCache')