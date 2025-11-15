const Datastore = require('nedb');
const path = require('path');
const util = require('util');
const ClientWrapper = require('./client')


class Database {
    constructor() {
        this.databases = {};
        this.initialized = false;
        this.initializing = false
        this.path = ''
        this.test=false
    }

    async init(chain) {
        if(this.initializing||this.initialized){
            return
        }
        this.initializing= true

        const instance = await ClientWrapper.getInstance();
        if (!chain) {
            
            chain = await instance.getChain();
        }

        this.test = await instance.getTest() 

        while (!chain) {
            console.log('Waiting for chain...');
            await new Promise(resolve => setTimeout(resolve, 300));
            const instance = await ClientWrapper.getInstance();
            chain = instance.chain;
        }
        let test = 'test'
        if(this.test==false){
            test = 'main'
        }
        const folderName = chain.toLowerCase()+'-'+test
        const dbPath = path.join(__dirname, '..', 'nedb-data', folderName);
        this.path=dbPath
        const categories = ['ammRegistry', 'ammState','txIndex', 'propertyList', 
        'oracleList', 'oracleData', 'contractList','tallyMap', 'tallyMapDelta', 
        'marginMapDelta', 'marginMaps', 'clearlists','attestations', 'clearing', 
        'consensus', 'persistence','volumeIndex','channels', 'withdrawQueue', 
        'activations', 'insurance','orderBooks','feeCache', 'tradeHistory', 
        'fundingEvents', 'vaults','syntheticTokens','liquidations', 'scaling',
        'channelDelta','iou'
        ];

        categories.forEach(category => {
            try {
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
            } catch (error) {
                console.error(`Error initializing database for category ${category}:`, error);
                throw error; // Re-throw error after logging
            }
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
