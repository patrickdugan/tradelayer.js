const Datastore = require('nedb');
const path = require('path');

const chain = 'ltc-test'; // Change this to 'btc' or 'doge' as needed
const baseDir = path.join(__dirname, '..', 'nedb-data', chain);

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

const paths = {
    propertyListDbPath: 'propertyList.db',
    tallyMapDbPath: 'tallyMap.db',
    activationsDbPath: 'activations.db',
    consensusDbPath: 'consensus.db',
    orderBooksDbPath: 'orderBooks.db',
    insuranceDbPath: 'insurance.db',
    oracleListDbPath: 'oracleList.db',
    contractListDbPath: 'contractList.db',
    tradeHistoryDbPath: 'tradeHistory.db',
    oracleDataDbPath: 'oracleData.db',
    marginMapDbPath: 'marginMaps.db',
    tallyMapDeltasDbPath: 'tallyMapDelta.db',
    marginMapDeltasDbPath: 'marginMapDelta.db',
    channelMapDeltasDbPath: 'channelDelta.db',
    channelsDbPath: 'channels.db',
    withdrawalQueueDbPath: 'withdrawalQueue.db',
    liquidationsDbPath: 'liquidations.db',
    feeCacheDbPath: 'feeCache.db',
    volumeIndexDbPath: 'volumeIndex.db',
    clearListDbPath: 'clearLists.db',
    attestationsDbPath: 'attestations.db',
    vaultsDbPath: 'vaults.db',
    syntheticTokensDbPath: 'syntheticTokens.db',
};

for (const [name, relativePath] of Object.entries(paths)) {
    clearDatastore(path.join(baseDir, relativePath), name);
}
