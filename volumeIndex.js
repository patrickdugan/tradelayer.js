const { dbFactory } = require('./db.js')
const { contractRegistry } = require('./contractRegistry.js')
const TxUtils = require('./txUtils.js')

class VolumeIndex {
    constructor(db) {
        this.db = db
    }

    async calculateAndTrackVolume(transactions, prices) {
        let cumulativeVolume = 0;
        const volumeByBlock = {};

        for (const tx of transactions) {
            const volume = tx.amount * prices[tx.token];
            cumulativeVolume += volume;

            if (!volumeByBlock[tx.block]) {
                volumeByBlock[tx.block] = 0;
            }
            volumeByBlock[tx.block] += volume;
        }

        await this.db.put('cumulativeVolume', cumulativeVolume)
        await this.db.put('volumeByBlock', JSON.stringify(volumeByBlock))
    }

    async sampleTradeTransactions(blockNumber) {
        // Replace with actual logic to fetch transactions
        const transactions = [];
        return transactions;
    }

    async getTokenPriceInLTC(tokenId) {
        const response = await fetch(`https://api.pricefeed.com/token/${tokenId}`)
        const data = await response.json()
        return data.priceInLTC;
    }

    calculateVolumeInLTC(tradeTransaction, tokenPrices) {
        const tokenPriceInLTC = tokenPrices[tradeTransaction.tokenId];
        return tradeTransaction.amount * tokenPriceInLTC;
    }

    async updateCumulativeVolume(volumeInLTC) {
        let currentCumulativeVolume = 0;
        try {
            currentCumulativeVolume = Number(await this.db.get('cumulativeVolume'))
        } catch (error) {
            if (error.type !== 'NotFoundError') {
                throw error;
            }
        }

        const newCumulativeVolume = currentCumulativeVolume + volumeInLTC;
        await this.db.put('cumulativeVolume', newCumulativeVolume.toString())
    }

    async saveVolumeData(blockNumber, volumeData) {
        await this.db.put(`block-${blockNumber}`, JSON.stringify(volumeData))
    }

    async processBlock(blockNumber) {
        try {
            const trades = await this.sampleTradeTransactions(blockNumber)
            let blockVolumeData = [];
            let cumulativeVolumeInLTC = 0;

            for (const trade of trades) {
                const priceInLTC = await this.getTokenPriceInLTC(trade.tokenId)
                const volumeInLTC = this.calculateVolumeInLTC(trade, { [trade.tokenId]: priceInLTC })

                blockVolumeData.push({ trade, volumeInLTC })
                cumulativeVolumeInLTC += volumeInLTC;
            }

            await this.updateCumulativeVolume(cumulativeVolumeInLTC)
            await this.saveVolumeData(blockNumber, blockVolumeData)
        } catch (error) {
            console.error(`Error processing block ${blockNumber}:`, error)
        }
    }

    async runVolumeIndexing() {
        const latestBlockNumber = await TxUtils.getBlockCountAsync()
        for (let blockNumber = 3082500; blockNumber <= latestBlockNumber; blockNumber++) {
            await this.processBlock(blockNumber)
        }
    }

    static async getVwapData(contractId) {
        if (contractRegistry.isNativeContract(contractId)) {
            // Retrieve contract information
            const contractInfo = contractRegistry.getContractInfo(contractId)
            if (!contractInfo?.indexPair) {
                console.error(`Contract information not found for contract ID: ${contractId}`)
                return null;
            }

            // Extract property IDs from the contract's index pair
            const [propertyId1, propertyId2] = contractInfo.indexPair;

            // Calculate and return the VWAP
            return await this.calculateVwap(propertyId1, propertyId2)
        } else {
            console.error(`Contract ID ${contractId} is not a native contract.`)
            return null;
        }
    }

    static async calculateVwap(propertyId1, propertyId2) {
        try {
            // Retrieve LTC prices for both tokens
            const priceInLTC1 = await this.getTokenPriceInLTC(propertyId1)
            const priceInLTC2 = await this.getTokenPriceInLTC(propertyId2)

            // Check if both prices are valid to avoid division by zero
            if (priceInLTC1 && priceInLTC2 && priceInLTC2 !== 0) {
                // Calculate VWAP
                const vwap = priceInLTC1 / priceInLTC2;
                return vwap;
            } else {
                throw new Error("Invalid prices or division by zero encountered")
            }
        } catch (error) {
            console.error(`Error calculating VWAP for property IDs ${propertyId1} and ${propertyId2}:`, error)
            throw error;
        }
    }
}

exports.volumeIndex = new VolumeIndex(dbFactory.getDatabase('tradeVolumeDB')
