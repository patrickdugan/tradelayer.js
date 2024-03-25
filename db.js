const MongoClient = require('mongodb').MongoClient;
const url = 'mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=tl.js1.0';

class Database {
    constructor() {

        this.db = new MongoClient(url).db('local');
        
        this.coll = {};
        [   
            'txIndex',
            'propertyList',
            'oracleList',
            'oracleData',
            'contractList',
            'tallyMap',
            'tallyMapDelta',
            'marginMapDelta',
            'marginMaps',
            'whitelists',
            'clearing',
            'consensus',
            'persistence',
            'volumeIndex',
            'channels',
            'withdrawQueue',
            'activations',
            'insurance',
            'orderBooks',
            'feeCache',
            'tradeHistory',
            'fundingEvents',
            'vaults',
            'syntheticTokens',
            'liquidations'
        ]
        .forEach(c => this.coll[c] = this.db.collection(c));

        console.log('mongodb: initialized');
    }

    getCollection(cn) {
        return this.coll[cn];
    }

    async dropCollection(cn, enforce=false) {
        if (enforce) {
            await this.db.dropCollection(cn);
        }
    }

    async dropDb(enforce=false) {
        if (enforce) {
            await this.db.dropDatabase();
        }
    }
}

module.exports = new Database()
