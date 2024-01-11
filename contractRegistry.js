const BigNumber = require('bignumber.js')
const { dbFactory } = require('./db.js')

class ContractRegistry {

    constructor(db) {
        this.db = db
        this.contractList = new Map()
        this.oracleList = new Map()
        this.nativeList = new Map()
    }

    async load() {
        try {
            const docs = await this.db.getDatabase('contractList').findAsync({ type: 'contractSeries' })
            return this.contractList = new Map(docs.map(doc => [doc.id, doc.data]))
        } catch (error) {
            console.error('Error loading contract series data:', error)
        }
    }

    async createContractSeries(native, underlyingOracleId, onChainData, notionalPropertyId, notionalValue, collateralPropertyId, leverage, expiryPeriod, series, inverse, fee, block, txid) {
        // Generate a unique ID for the new contract series
        await this.load()
        
        const seriesId = this.getNextId(this.contractList)
        const contracts = this.generateContracts(expiryPeriod, series, seriesId, block)

        // Create the contract series object
        const contractSeries = {
            native: native,
            underlyingOracleId: underlyingOracleId,
            onChainData: onChainData,
            notionalPropertyId: notionalPropertyId,
            notionalValue: notionalValue,
            collateralPropertyId: collateralPropertyId,
            leverage: leverage,
            expiryPeriod: expiryPeriod,
            series: series,
            inverse: inverse,
            fee: fee,
            contracts: {
                expired: [],
                unexpired: contracts
            }
        };

        // Add the new contract series to the contract list
        this.contractList.set(seriesId, contractSeries)

        // Save the updated contract list back to the database
        await this.save(this.contractList, 'contractSeries')

        console.log(`New contract series created: ID ${seriesId}`)
        return seriesId; // Return the new series ID
    }

    getNextId(contractList) {
        let nums = [...contractList.values()].map(v=>v.id)
        let maxId = Math.max(...nums)
        return (Number.isFinite(maxId) ? maxId : 0) + 1
    }

    // Generate contracts within the series
    generateContracts(expiryPeriod, series, seriesId, block) {
        let contracts = [];
        let expirationBlock = parseInt(block) + parseInt(expiryPeriod)

        for (let i = 0; i < series; i++) {
            contracts.push({
                id: `${seriesId}-${expirationBlock}`,
                expirationBlock: expirationBlock,
            })
            expirationBlock += parseInt(expiryPeriod)
        }
        return contracts;
    }

    async saveData(dataMap, dataType) {
        const dataArray = Array.from(dataMap.entries()).map(([id, data]) => ({
            id, data, type: dataType
        }))

        await Promise.all(dataArray.map(entry =>
            this.db.getDatabase('contractList').updateAsync({ id: entry.id }, entry, { upsert: true })
        ))
    }

    async save() {
        await this.saveData(this.contractList, 'contractSeries')
        await this.saveData(this.oracleList, 'oracleContracts')
        await this.saveData(this.nativeList, 'nativeContracts')
    }

    isValidSeriesId(seriesId) {
        // Check if the seriesId exists in the contract series registry
        // The registry could be a database, a map, or any other data structure
        // that stores information about the contract series in your system
        return this.contractList.has(seriesId)
    }

    async getAllContracts() {
        return await this.load()
    }

    getContractType(contractId) {
        const contractInfo = this.getContractInfo(contractId)
        if (!contractInfo) {
            throw new Error("Contract type not found for contract ID: " + contractId)
        }
        return contractInfo.native ? 'native' : 'oracle'
    }

    getContractInfo(contractId) {
        return this.contractList.has(contractId) ? this.contractList[contractId] : undefined
    }

    async isNativeContract(contractId) {
        const contractInfo = this.getContractInfo(contractId)
        return contractInfo?.native ? true : false;
    }

    isInverse(contractId) {
        const contractInfo = this.getContractInfo(contractId)
        return contractInfo?.inverse;
    }

    // Determine if a contract is an oracle contract
    isOracleContract(contractId) {
        const contractInfo = this.getContractInfo(contractId)
        return contractInfo?.type === 'oracle';
    }

    // Function to get initial margin requirement for a contract
    getInitialMargin(contractId) {
        console.log('checking contractId inside getInitialMargin ' + contractId)
        const contractInfo = this.getContractInfo(contractId)
        console.log('getting contractInfo inside getInit Margin ' + JSON.stringify(contractInfo))
        let inverse = contractInfo.native.inverse;
        let notionalValue = contractInfo.native.notionalValue
        let leverage = contractInfo.native.leverage
        console.log('inside getInitialMargin, inverse:' + inverse + 'notional ' + notionalValue + 'lvg. ' + leverage)
        if (inverse) {
            // For inverse contracts, margin is calculated based on notional value
            return BigNumber(notionalValue).div(leverage).toNumber()
        } else {
            /*
            // For linear contracts, check collateral and calculate based on oracle price or property value
            const collateralValue = await ContractRegistry.getCollateralValue(contractInfo)
            return BigNumber(collateralValue).div(leverage)
            */
            return BigNumber(notionalValue).div(leverage).toNumber() //assuming property is like a dollarcoin just to get things moving, you know
        }
    }

    // TODO: impl!!!
    // Helper function to get collateral value for linear contracts
    // static async getCollateralValue(contractInfo) {
    //     const PropertyManager = require('./property.js')
    //     const OracleList = require('./oracle.js')
    //     const { collateralPropertyId, oracleId } = contractInfo;
    //     if (collateralPropertyId) {
    //         // If collateral is a property, use its value
    //         const propertyData = await PropertyManager.getPropertyData(collateralPropertyId)
    //         return propertyData ? propertyData.value : 0; // Example value fetching logic
    //     } else if (oracleId) {
    //         // If collateral is based on an oracle, use the latest price
    //         const latestPrice = await OracleRegistry.getOracleData(oracleId)
    //         return latestPrice || 0; // Example oracle price fetching logic
    //     }
    //     return 0; // Default to 0 if no valid collateral source
    // }

    // Method to get the collateral property ID for a given contract ID
    getCollateralId(contractId) {
        // Load contract information
        const contractInfo = this.getContractInfo(contractId)

        // Check if contract information is available
        if (!contractInfo) {
            throw new Error(`Contract info not found for contract ID: ${contractId}`)
        }
        //console.log('getting contract info for '+contractId +' '+JSON.stringify(contractInfo.native.collateralPropertyId))
        // Return the collateral property ID from the contract information
        //console.log('returning collateral id '+contractInfo.native.collateralPropertyId+ ' type of '+typeof contractInfo.native.collateralPropertyId)
        return contractInfo.native.collateralPropertyId;
    }

    // In the contract order addition process
    async moveCollateralToMargin(sender, contractId, amount) {
        const initialMarginPerContract = this.getInitialMargin(contractId)
        //console.log('initialMarginPerContract '+initialMarginPerContract)
        const collateralPropertyId = this.getCollateralId(contractId)
        //console.log('collateralPropertyId '+collateralPropertyId)
        const totalInitialMargin = BigNumber(initialMarginPerContract).times(amount).toNumber()
        console.log(totalInitialMargin)
        // Move collateral to margin position
        await txTally.updateBalance(sender, collateralPropertyId, -totalInitialMargin, 0, totalInitialMargin, 0, true)
        return totalInitialMargin
    }

    // Calculate the 1-hour funding rate for an oracle contract
    async calculateFundingRate(contractId) {
        if (!this.isOracleContract(contractId)) {
            return 0; // Return zero for non-oracle contracts
        }

        // TODO: fixme
        // Get oracle data for the last 24 blocks
        const oracleData = {}   //await Oracles.getLast24BlocksData(contractId)
        const avgOraclePrice = 1.0  //ContractRegistry.calculateAveragePrice(oracleData)

        // Placeholder for the logic to get the average trade price for the contract
        // const avgTradePrice = ...;

        // Calculate the funding rate based on the difference between oracle price and trade price
        const priceDifference = avgTradePrice / avgOraclePrice;
        let fundingRate = 0;

        if (priceDifference > 1.0005) {
            fundingRate = (priceDifference - 1.0005) * oracleData.length; // Example calculation
        } else if (priceDifference < 0.9995) {
            fundingRate = (0.9995 - priceDifference) * oracleData.length; // Example calculation
        }

        return fundingRate;
    }

    // TODO: factor out to eliminate dependencies on tally/margin/synth
    // async applyFundingRateToSystem(contractId) {
    //     const fundingRate = await this.calculateFundingRate(contractId)

    //     // Apply funding rate to marginMap+tallyMap
    //     for (const [address, position] of marginMap.entries()) {
    //         if (position.contractId === contractId) {
    //             const fundingAmount = calculateFundingAmount(position.size, fundingRate)
    //             TallyMap.updateBalance(address, contractId, fundingAmount)
    //             marginMap.updatePosition(address, contractId, fundingAmount)
    //         }
    //     }

    //     // Apply funding rate to vaulted contracts
    //     for (const [vaultId, vault] of SynthRegistry.vaults.entries()) {
    //         if (vault.contractId === contractId) {
    //             const fundingAmount = this.calculateFundingAmount(vault.contractBalance, fundingRate)
    //             SynthRegistry.applyPerpetualSwapFunding(vaultId, contractId, fundingAmount)
    //         }
    //     }

    //     // Save changes
    //     await TallyMap.save()
    //     await marginMap.save()
    //     await SynthRegistry.saveVaults()
    // }

    static calculateFundingAmount(contractSize, fundingRate) {
        return contractSize * fundingRate;
    }


    // Calculate the average price from oracle data
    static calculateAveragePrice(oracleData) {
        if (!oracleData?.length) return 0;

        const total = oracleData.reduce((acc, data) => acc + data.price, 0)
        return total / oracleData.length;
    }

    // Save funding event for a contract
    async saveFundingEvent(contractId, fundingRate, blockHeight) {
        const fundingEvent = { contractId, fundingRate, blockHeight };
        await this.db.getDatabase('fundingEvents').insertAsync(fundingEvent)
    }

    // Load funding events for a contract
    async loadFundingEvents(contractId) {
        const fundingEvents = await this.db.getDatabase('fundingEvents').findAsync({ contractId: contractId })
        return fundingEvents.map(doc => doc)
    }
}

exports.contractRegistry = new ContractRegistry(dbFactory)
