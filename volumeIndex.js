const fetch = require('node-fetch'); // For HTTP requests (e.g., price lookups)
const db = require('./db.js')
const Litecoin = require('litecoin')
const util = require('util')
const Contracts = require('./contractRegistry.js')

class VolumeIndex {
    constructor(db) {
        // Initialize data structures and database path
        this.pairVolumes = {};
        this.pairFees = {};
        this.tokenPairCumulativeVolumes = 0;
        this.ltcPairTotalVolume = 0;
        this.contractCumulativeVolumes = 0;
        this.cumulativeFees = 0;
        this.dbPath = dbPath;
        this.VWAPIndex = new Map()
    }

    static async saveVolumeDataById(id, volume,price,blockHeight, type) {
        await db.getDatabase('volumeIndex').updateAsync(
            { _id: id },
            { value: { blockHeight:blockHeight, volume: volume, price:price } },
            { upsert: true }
        );

        // Update global cumulative volume variables
        this.updateCumulativeVolumes(volume, type,id);
    }

       static async updateCumulativeVolumes(volume, type, id) {
        if (type === "contract") {
            const collateralId = await Contracts.getCollateralId(id);
            const priceInLTC = await this.getTokenPriceInLTC(collateralId);
            const notionalValue= Contracts.getNotionalValue(id)
            const volumeInLTC = volume * priceInLTC*notionalValue;
            this.contractCumulativeVolumes += volumeInLTC;
            this.globalCumulativeVolume += volume;
        } else if (type === "token") {
            const [tokenId1, tokenId2] = id.split('-');
            const priceInLTC1 = await this.getTokenPriceInLTC(tokenId1);
            const priceInLTC2 = await this.getTokenPriceInLTC(tokenId2);
            const avgPriceInLTC = (priceInLTC1 + priceInLTC2) / 2;
            const volumeInLTC = volume * avgPriceInLTC;
            this.ltcPairTotalVolume += volumeInLTC;
            this.globalCumulativeVolume += volume;
        } else {
            // Assuming the volume is directly in LTC
            this.ltcPairTotalVolume += volume;
            this.globalCumulativeVolume += volume;
        }
        // Assuming volume is in LTC
    }

    static async getTokenPriceInLTC(tokenId) {
        // Attempt to fetch the VWAP price from the database
        const vwapData = await db.getDatabase('volumeIndex').findOneAsync({ _id: `vwap-${tokenId}` });
        
        if (vwapData && vwapData.value && vwapData.value.price) {
            return vwapData.value.price;
        }

        // If VWAP price is not available, return a default low value
        return 0.001; // Minimum price
    }

    static getCumulativeVolumes() {
        // Return an object containing the global cumulative volume data
        return {
            globalCumulativeVolume: this.globalCumulativeVolume,
            // Add other cumulative volume variables here if needed
            ltcPairTotalVolume: this.ltcPairTotalVolume,
            contractCumulativeVolumes: this.contractCumulativeVolumes
        };
    }


    static async getVolumeDataById(id) {
        return await db.getDatabase('volumeIndex').findOneAsync({ _id: id });
    }

    static async sampleVolumesByBlock(blockHeight) {
        const volumeIndexData = await db.getDatabase('volumeIndex').findAsync({ blockHeight });
        return volumeIndexData.map(entry => ({ id: entry._id, volume: entry.volume }));
    }

    static async sampleVolumesByBlockRange(startBlockHeight, endBlockHeight) {
        const volumeIndexData = await db.getDatabase('volumeIndex').findAsync({ 
            blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
        });
        return volumeIndexData.map(entry => ({ id: entry._id, volume: entry.volume }));
    }

    static async calculateCumulativeVolume(id1, id2) {
        const volumeIndexData = await db.getDatabase('volumeIndex').findAsync({ _id: { $regex: `^${id1}-${id2}-` } });
        let cumulativeVolume = 0;
        volumeIndexData.forEach(entry => cumulativeVolume += entry.volume);
        return cumulativeVolume;
    }

    static async saveCumulativeVolume(id1, id2, cumulativeVolume) {
        const id = `cumulative-${id1}-${id2}`;
        await this.saveVolumeDataById(id, null, cumulativeVolume);
    }

    static async auditVWAP(blockHeight) {
        const volumeData = await this.sampleVolumesByBlock(blockHeight);

        // Calculate total volume and sum of (volume * price)
        let totalVolume = 0;
        let sumVolumeTimesPrice = 0;

        for (const entry of volumeData) {
            const price = await this.getTokenPriceInLTC(entry.id);
            const volume = entry.volume;

            totalVolume += volume;
            sumVolumeTimesPrice += volume * price;
        }

        // Avoid division by zero
        if (totalVolume === 0) {
            return null;
        }

        // Calculate VWAP
        const vwap = sumVolumeTimesPrice / totalVolume;
        return vwap;
    }

    static calculateVWAP(data, contract = false) {
        // Calculate total volume and sum of (volume * price)
        let totalVolume = 0;
        let sumVolumeTimesPrice = 0;

        for (const entry of data) {
            let volume;
            let price;

            if (entry.amount1 !== undefined && entry.amount2 !== undefined) {
                volume = contract ? entry.amount2 : entry.amount1;
                price = contract ? entry.amount1 : entry.amount2;
            } else if (entry.amount !== undefined && entry.price !== undefined) {
                volume = entry.amount;
                price = entry.price;
            } else {
                throw new Error("Invalid data format. Each entry must contain either 'amount1' and 'amount2', or 'amount' and 'price'.");
            }

            totalVolume += volume;
            sumVolumeTimesPrice += volume * price;
        }

        // Avoid division by zero
        if (totalVolume === 0) {
            return null;
        }

        // Calculate VWAP
        const vwap = sumVolumeTimesPrice / totalVolume;
        return vwap;
    }

    static async saveVWAP(blockHeight, vwap) {
        await this.saveVolumeDataById(`vwap-${blockHeight}`, blockHeight, vwap);
    }
}

module.exports = VolumeIndex;
