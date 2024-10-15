const Datastore = require('nedb');
const path = require('path');
const util = require('util');
const ClientWrapper = require('./client')

class Database {
    constructor() {
        this.databases = {};
        this.initialized = false;
    }

    async init(chain) {

        //await new Promise(resolve => setTimeout(resolve, 300)); // Wait 0.3 seconds
        // Wait for client to finish setting the chain

        if (!chain) {
            const instance = await ClientWrapper.getInstance()
            chain = instance.chain //throw new Error('Unable to determine blockchain chain.');
        }

        const categories = [
            'txIndex', 'propertyList', 'oracleList', 'oracleData', 'contractList',
            'tallyMap', 'tallyMapDelta', 'marginMapDelta', 'marginMaps', 'clearlists',
            'attestations', 'clearing', 'consensus', 'persistence', 'volumeIndex',
            'channels', 'withdrawQueue', 'activations', 'insurance', 'orderBooks',
            'feeCache', 'tradeHistory', 'fundingEvents', 'vaults', 'syntheticTokens',
            'liquidations'
        ];

        if(!chain){
            console.log('wait for chain')
            await new Promise(resolve => setTimeout(resolve, 300)); // Wait 0.3 seconds
        }
        const dbPath = path.join(__dirname, '..', 'nedb-data', chain.toLowerCase());

        categories.forEach(category => {
            const db = new Datastore({ 
                filename: path.join(dbPath, `${category}.db`), 
                autoload: true 
            });

            db.findAsync = util.promisify(db.find.bind(db));
            db.insertAsync = util.promisify(db.insert.bind(db));
            db.removeAsync = util.promisify(db.remove.bind(db));
            db.updateAsync = util.promisify(db.update.bind(db));
            db.findOneAsync = util.promisify(db.findOne.bind(db));
            db.countAsync = util.promisify(db.count.bind(db));

            this.databases[category] = db;
        });

        this.initialized = true;
    }

    async getDatabase(category) {
        if (!this.initialized) {
            await this.init();
        }
        return this.databases[category];
    }
}

const databaseInstance = new Database();
(async () => {
    await databaseInstance.init();
})();

module.exports = databaseInstance;
