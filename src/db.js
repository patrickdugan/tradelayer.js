// db.js
const Datastore = require('nedb');
const path = require('path');
const util = require('util');
const { getChain } = require('./client');

class Database {
    constructor() {
        this.databases = {};

        const categories = [
            'txIndex', 'propertyList', 'oracleList', 'oracleData', 'contractList',
            'tallyMap', 'tallyMapDelta', 'marginMapDelta', 'marginMaps', 'clearlists',
            'attestations', 'clearing', 'consensus', 'persistence', 'volumeIndex',
            'channels', 'withdrawQueue', 'activations', 'insurance', 'orderBooks',
            'feeCache', 'tradeHistory', 'fundingEvents', 'vaults', 'syntheticTokens',
            'liquidations'
        ];

        const chain = getChain();
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
    }

    getDatabase(category) {
        return this.databases[category];
    }
}

module.exports = new Database();
