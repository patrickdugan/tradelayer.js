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
        console.log('saving volume index data '+id, volume, price, blockHeight, type)
        await db.getDatabase('volumeIndex').updateAsync(
            { _id: id },
            { value: { blockHeight:blockHeight, volume: volume, price:price, type } },
            { upsert: true }
        );

        // Update global cumulative volume variables
        await VolumeIndex.updateCumulativeVolumes(volume, type,id);
        return
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
        await db.getDatabase('volumeIndex').updateAsync(
            { _id: 'ltcPairCumulativeVolume' },
            { value: this.ltcPairTotalVolume },
            { upsert: true }
        );

        await db.getDatabase('volumeIndex').updateAsync(
            { _id: 'globalCumulativeVolume' },
            { value: this.globalCumulativeVolume },
            { upsert: true }
        );
        return
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

    static async getCumulativeVolumes() {
        // Check if globalCumulativeVolume and ltcPairTotalVolume are defined and not zero
        if (!this.globalCumulativeVolume || this.globalCumulativeVolume === 0) {
            // Fetch globalCumulativeVolume from the database
            try {
                const globalCumulativeVolumeFromDB = await db.getDatabase('volumeIndex').findOneAsync({ _id: 'globalCumulativeVolume' });
                if (globalCumulativeVolumeFromDB) {
                    this.globalCumulativeVolume = globalCumulativeVolumeFromDB.value;
                }
            } catch (error) {
                console.error('Error fetching global cumulative volume:', error);
                // Handle or log the error as needed
            }
        }

        if (!this.ltcPairTotalVolume || this.ltcPairTotalVolume === 0) {
            // Fetch ltcPairTotalVolume from the database
            try {
                const ltcPairTotalVolumeFromDB = await db.getDatabase('volumeIndex').findOneAsync({ _id: 'ltcPairCumulativeVolume' });
                if (ltcPairTotalVolumeFromDB) {
                    this.ltcPairTotalVolume = ltcPairTotalVolumeFromDB.value;
                }
            } catch (error) {
                console.error('Error fetching LTC pair total volume:', error);
                // Handle or log the error as needed
            }
        }

        // Return an object containing the cumulative volume data
        return {
            globalCumulativeVolume: this.globalCumulativeVolume,
            ltcPairTotalVolume: this.ltcPairTotalVolume,
            contractCumulativeVolumes: this.contractCumulativeVolumes
            // Add other cumulative volume variables here if needed
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
        await saveVolumeDataById(id, null, cumulativeVolume);
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


    
    static async getVwapData(propertyId1, propertyId2, trailingBlocks) {
        try {
         // Fetch the N most recent VWAP entries for the specified property pair
            const vwapData = await db.getDatabase('volumeIndex').findAsync({
                _id: { $regex: `^vwap-${propertyId1}-${propertyId2}-` }
            }, {
                sort: { blockHeight: -1 },  // Sort by blockHeight in descending order
                limit: trailingBlocks      // Limit to the N most recent entries
            });

            // Calculate total volume and sum of (volume * price)
            let totalVolume = 0;
            let sumVolumeTimesPrice = 0;

            for (const entry of vwapData) {
                const price = entry.value.price;
                const volume = entry.value.volume;

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
        } catch (error) {
            console.error('Error fetching VWAP data:', error);
            throw new Error('Failed to fetch VWAP data.');
        }
    }

    static async saveVWAP(id, blockHeight, vwap) {
        await db.getDatabase('volumeIndex').updateAsync(
            { _id: 'vwap-'+id },
            { value: { blockHeight:blockHeight, volume: volume, price:price } },
            { upsert: true }
        );
    }

    static async calculateLiquidityReward(tradeVolume, token) {

        if (!this.globalCumulativeVolume || this.globalCumulativeVolume === 0) {
            const blob = await getCumulativeVolumes; // Assuming this function fetches or initializes globalCumulativeVolume
            this.globalCumulativeVolume=blob.globalCumulativeVolume
        }
        
        if(token!=0){
            const tokenPriceInLTC = await this.getTokenPriceInLTC(token);
        }

        tradeVolume=tradeVolume*tokenPriceInLTC
        const totalVolume = this.globalCumulativeVolume - tradeVolume;
        
        // Calculate logarithmic value
        const logVolume = Math.log10(totalVolume / 1e9); // Log base 10 with cap at 1 billion LTC

        // Calculate liquidity reward based on log value
        let liquidityReward = 0;
        if (logVolume > 0) {
            liquidityReward = logVolume * 3e6 / 3; // Adjust 3e6 for percentage calculation
        }

        return liquidityReward;
    }

    static async baselineLiquidityReward(tradeVolume, fee, token) {
        const totalVolume = this.globalCumulativeVolume - tradeVolume;
        if(token!=0){

            // Step 1: Get LTC price of the token in question
            const tokenPriceInLTC = await this.getTokenPriceInLTC(token);

            // Step 2: Get TL/LTC price (assuming TL is a specific token or currency)
            const tlPriceInLTC = await this.getTLPriceInLTC();

            // Step 3: Calculate fee in TL
            const feeInTL = fee * tokenPriceInLTC * tlPriceInLTC;
        }else{
            const feeInTL= fee * tlPriceInLTC
        }


        // Calculate logarithmic value
        const logVolume = Math.log10(totalVolume);

        // Calculate liquidity reward based on log value and fee
        let liquidityReward = 0;
        if (logVolume > 0) {
            const feeAdjustment = 1/logVolume; // Reducing by 10% per log 10
            liquidityReward = feeInTL * feeAdjustment;
        }
        
        return liquidityReward;
    }

    static async getTLPriceInLTC() {
        // Attempt to fetch the VWAP price from the database
        const vwapData = await db.getDatabase('volumeIndex').findOneAsync({ _id: `vwap-1` });
        
        if (vwapData && vwapData.value && vwapData.value.price) {
            return vwapData.value.price;
        }

        // If VWAP price is not available, return a default low value
        return 0.001; // Minimum price
    }



    static vestTokens(tradeVolume) {
        // Calculate logarithmic value
        const logVolume = Math.log10(this.globalCumulativeVolume / 1e9); // Log base 10 with cap at 100 billion LTC

        // Tier 1 vesting tokens (1000 to 100,000,000 LTC)
        let tier1Tokens = 0;
        if (logVolume > 0) {
            if (totalVolume >= 1000 && totalVolume <= 1e8) {
                tier1Tokens = logVolume * 1e6; // Adjust 1e6 for tokens calculation
            }
        }

        // Tier 2 vesting tokens (100,000,000 to 100 billion LTC)
        let tier2Tokens = 0;
        if (logVolume > 0) {
            if (totalVolume > 1e8 && totalVolume <= 1e11) {
                tier2Tokens = logVolume * 3e6; // Adjust 3e6 for tokens calculation
            }
        }

        return {
            tier1Tokens,
            tier2Tokens
        };
    }


}

module.exports = VolumeIndex;
