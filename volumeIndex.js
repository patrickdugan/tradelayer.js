const fetch = require('node-fetch'); // For HTTP requests (e.g., price lookups)
const db = require('./db.js')
const Litecoin = require('litecoin')
const util = require('util')
const client = new Litecoin.Client({

            host: '127.0.0.1',
            port: 18332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        });

const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'))

class VolumeIndex {
    constructor(db) {
        // Initialize data structures and database path
        this.pairVolumes = {};
        this.pairFees = {};
        this.pairCumulativeVolumes = {};
        this.ltcPairTotalVolume = 0;
        this.contractCumulativeVolumes = {};
        this.cumulativeFees = 0;
        this.dbPath = dbPath;
    }

    async saveVolumeDataById(id, blockHeight, volume) {
        await this.db.getDatabase('volumeIndex').updateAsync(
            { _id: id },
            { $set: { blockHeight, volume } },
            { upsert: true }
        );
    }

    async getVolumeDataById(id) {
        return await this.db.getDatabase('volumeIndex').findOneAsync({ _id: id });
    }

    async sampleVolumesByBlock(blockHeight) {
        const volumeIndexData = await this.db.getDatabase('volumeIndex').findAsync({ blockHeight });
        return volumeIndexData.map(entry => ({ id: entry._id, volume: entry.volume }));
    }

    async sampleVolumesByBlockRange(startBlockHeight, endBlockHeight) {
        const volumeIndexData = await this.db.getDatabase('volumeIndex').findAsync({ 
            blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
        });
        return volumeIndexData.map(entry => ({ id: entry._id, volume: entry.volume }));
    }

    async calculateCumulativeVolume(id1, id2) {
        const volumeIndexData = await this.db.getDatabase('volumeIndex').findAsync({ _id: { $regex: `^${id1}-${id2}-` } });
        let cumulativeVolume = 0;
        volumeIndexData.forEach(entry => cumulativeVolume += entry.volume);
        return cumulativeVolume;
    }

    async saveCumulativeVolume(id1, id2, cumulativeVolume) {
        const id = `cumulative-${id1}-${id2}`;
        await this.saveVolumeDataById(id, null, cumulativeVolume);
    }
}

module.exports = VolumeIndex;
