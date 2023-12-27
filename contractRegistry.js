const db = require('./db')
const path = require('path');
const util = require('util');
//const TxUtils = require('./txUtils.js')
const TxIndex = require('./txIndex.js')

class ContractRegistry {
    constructor() {
        // ... Other initializations ...
        this.contractList = new Map()
        this.oracleSeriesIndex = new Map(); // Initialize if needed
        this.nativeSeriesIndex = new Map(); // Initialize if needed
   
    }

    static async loadContractSeries() {
        const instance = ContractRegistry.getInstance(); // Access singleton instance
        try {
            const docs = await db.getDatabase('contractList').findAsync({ type: 'contractSeries' });
            instance.contractSeries = new Map(docs.map(doc => [doc.id, doc.data]));
        } catch (error) {
            console.error('Error loading contract series data:', error);
        }
    }

     // Singleton instance getter
    static getInstance() {
        console.log('contract List instance? '+ Boolean(this.instance)+ ' what is it '+JSON.stringify(this.instance))
        if (!this.instance) {
            this.instance = new ContractRegistry();
        }
        return this.instance;
    }

      static async createContractSeries(params) {
        const instance = ContractRegistry.getInstance(); // Access singleton instance

        // Generate a unique ID for the new contract series
        const seriesId = await ContractRegistry.getNextId();

        // Create the contract series object
        const contractSeries = {
            id: seriesId,
            underlyingOracleId: params.underlyingOracleId,
            onChainData: params.onChainData,
            notionalPropertyId: params.notionalPropertyId,
            notionalValue: params.notionalValue,
            collateralPropertyId: params.collateralPropertyId,
            leverage: params.leverage,
            inverse: params.inverse,
            fee: params.fee,
            contracts: {
                expired: [],
                unexpired: ContractRegistry.generateContracts(params, seriesId)
            }
        };

        // Save the new contract series to the in-memory map and the database
        instance.contractList.set(seriesId, contractSeries); // Use instance to access contractList
        await ContractRegistry.saveContractSeries(); // Assuming saveContractSeries is also static

        console.log(`New contract series created: ID ${seriesId}`);
        return seriesId; // Return the new series ID
    }


    // Generate contracts within the series
    static generateContracts(params, seriesId) {
        let contracts = [];
        const currentBlockHeight = TxIndex.fetchChainTip(); // Implement this method to get the current block height
        let expirationBlock = currentBlockHeight + params.expiryPeriod;

        for (let i = 0; i < params.series; i++) {
            contracts.push({
                id: `${seriesId}-${expirationBlock}`,
                expirationBlock: expirationBlock,
                ...params
            });
            expirationBlock += params.expiryPeriod;
        }

        return contracts;
    }

    static loadContractsFromDB() {
        return db.getDatabase('contractList').findAsync()
            .then(docs => {
                docs.forEach(doc => {
                    const { type, seriesId } = doc;
                    if (type === 'oracle') {
                        this.oracleSeriesIndex.set(seriesId, doc.data);
                    } else {
                        this.nativeSeriesIndex.set(seriesId, doc.data);
                    }
                });
            })
            .catch(error => {
                console.error('Error loading contracts from DB:', error);
                throw error;
            });
    }

    static async saveContractSeries() {
        const instance = ContractRegistry.getInstance();
        // Convert Map to array of objects for storage
        const seriesArray = [...instance.contractList].map(([id, data]) => ({ id, data, type: 'contractSeries' }));
        await Promise.all(seriesArray.map(series => db.getDatabase('contractList').updateAsync({ id: series.id }, series, { upsert: true })));
    }

    // ... Other methods ...

    static async saveIndexesToDb() {
        // Convert indexes to a storable format
        const oracleIndex = Object.entries(this.oracleSeriesIndex).map(([id, data]) => ({ id, data, type: 'oracleContracts' }));
        const nativeIndex = Object.entries(this.nativeSeriesIndex).map(([id, data]) => ({ id, data, type: 'nativeContracts' }));

        await Promise.all([...oracleIndex, ...nativeIndex].map(entry => db.getDatabase('contractList').updateAsync({ id: entry.id }, entry, { upsert: true })));
    }


     static async getNextId() {
        const instance = ContractRegistry.getInstance(); // Access singleton instance
        let maxId = 0;
        for (const [key] of instance.contractList.entries()) {
            const currentId = parseInt(key);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    static isValidSeriesId(seriesId) {
        const instance = ContractRegistry.getInstance(); // Access singleton instance
        // Check if the seriesId exists in the contract series registry
        // The registry could be a database, a map, or any other data structure
        // that stores information about the contract series in your system
        if (instance.contractList.has(seriesId)) {
            return true; // The seriesId is valid
        } else {
            return false; // The seriesId is not valid
        }
    }

    static getAllContracts() {

        const instance = ContractRegistry.getInstance(); // Access singleton instance
        let allContracts = [];
        // Add all oracle contracts
        for (const seriesId in instance.oracleSeriesIndex) {
            allContracts.push(...instance.oracleSeriesIndex[seriesId]);
        }
        // Add all native contracts
        for (const seriesId in instance.nativeSeriesIndex) {
            allContracts.push(...instance.nativeSeriesIndex[seriesId]);
        }
        return allContracts;
    }

    async hasOpenPositions(contract) {
        try {
            // Load the margin map for the contract's series ID
            let marginMap = await MarginMap.loadMarginMap(contract.seriesId);
            // Check if the margin map has any non-zero positions for this contract
            for (let [address, positionData] of marginMap.margins.entries()) {
                if (positionData.contracts > 0) {
                    return true; // Found an open position
                }
            }
            return false; // No open positions found
        } catch (error) {
            console.error('Error checking open positions for contract:', contract.seriesId, error);
            throw error;
        }
    }

    static async getContractType(contractId) {
        const instance = ContractRegistry.getInstance(); // Access singleton instance
        // Logic to determine the contract type
        // This could involve checking your database or in-memory data structure
        // Example:
        if (instance.oracleSeriesIndex[contractId]) {
            return 'oracle';
        } else if (instance.nativeSeriesIndex[contractId]) {
            return 'native';
        } else {
            throw new Error("Contract type not found for contract ID: " + contractId);
        }
    }

    static isNativeContract(contractId) {
                const instance = ContractRegistry.getInstance(); // Access singleton instance

        // Check if the contractId exists in the nativeSeriesIndex
        return Boolean(instance.nativeSeriesIndex && instance.nativeSeriesIndex[contractId]);
    }

    static getContractInfo(contractId) {
        const instance = ContractRegistry.getInstance(); // Access singleton instance

        // Fetch contract information from the nativeSeriesIndex or oracleSeriesIndex
        if (instance.isNativeContract(contractId)) {
            return instance.nativeSeriesIndex[contractId];
        } else if (instance.oracleSeriesIndex && instance.oracleSeriesIndex[contractId]) {
            return instance.oracleSeriesIndex[contractId];
        }
        console.log(`Contract information not found for contract ID: ${contractId}`);
        return null;
    }

     // Function to get initial margin requirement for a contract
    static async getInitialMargin(contractId) {
        const contractInfo = ContractRegistry.getContractInfo(contractId);
        if (!contractInfo) {
            throw new Error(`Contract info not found for contract ID: ${contractId}`);
        }

        const { inverse, notionalValue, leverage } = contractInfo;
        if (inverse) {
            // For inverse contracts, margin is calculated based on notional value
            return BigNumber(notionalValue).div(leverage);
        } else {
            // For linear contracts, check collateral and calculate based on oracle price or property value
            const collateralValue = await ContractRegistry.getCollateralValue(contractInfo);
            return BigNumber(collateralValue).div(leverage);
        }
    }

    // Helper function to get collateral value for linear contracts
    static async getCollateralValue(contractInfo) {
        const PropertyManager = require('./property.js')
        const OracleList = require('./oracle.js')
        const { collateralPropertyId, oracleId } = contractInfo;
        if (collateralPropertyId) {
            // If collateral is a property, use its value
            const propertyData = await PropertyManager.getPropertyData(collateralPropertyId);
            return propertyData ? propertyData.value : 0; // Example value fetching logic
        } else if (oracleId) {
            // If collateral is based on an oracle, use the latest price
            const latestPrice = await OracleRegistry.getOracleData(oracleId);
            return latestPrice || 0; // Example oracle price fetching logic
        }
        return 0; // Default to 0 if no valid collateral source
    }

        // In the contract order addition process
    async moveCollateralToMargin(senderAddress, contractId, amount, contractsRegistry) {
        const TallyMap = require('./tally.js')
        const MarginMap = require('./marginMap.js')
        const initialMarginPerContract = await ContractRegistry.getInitialMargin(contractId);
        const totalInitialMargin = BigNumber(initialMarginPerContract).times(amount);

        // Move collateral to margin position
        await TallyMap.updateBalance(senderAddress, collateralPropertyId, -totalInitialMargin, totalInitialMargin, 0, 0);

        // Update MarginMap for the contract series
        await MarginMap.updateMargin(contractId, senderAddress, amount, totalInitialMargin);
    }

     // Determine if a contract is an oracle contract
    static async isOracleContract(contractId) {
        const instance = ContractRegistry.getInstance(); // Access singleton instance
        const contractInfo = await ContractRegistry.getContractInfo(contractId);
        return contractInfo && contractInfo.type === 'oracle';
    }

    // Calculate the 1-hour funding rate for an oracle contract
    static async calculateFundingRate(contractId) {
        const isOracle = await ContractRegistry.isOracleContract(contractId);
        if (!isOracle) {
            return 0; // Return zero for non-oracle contracts
        }

        // Get oracle data for the last 24 blocks
        const Oracles = require('./Oracles');
        const oracleData = await Oracles.getLast24BlocksData(contractId);
        const avgOraclePrice = ContractRegistry.calculateAveragePrice(oracleData);

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

    async applyFundingRateToSystem(contractId) {
        const fundingRate = await ContractsRegistry.calculateFundingRate(contractId);
        
        // Apply funding rate to marginMap+tallyMap
        for (const [address, position] of marginMap.entries()) {
            if (position.contractId === contractId) {
                const fundingAmount = calculateFundingAmount(position.size, fundingRate);
                TallyMap.updateBalance(address, contractId, fundingAmount);
                marginMap.updatePosition(address, contractId, fundingAmount);
            }
        }

        // Apply funding rate to vaulted contracts
        for (const [vaultId, vault] of SynthRegistry.vaults.entries()) {
            if (vault.contractId === contractId) {
                const fundingAmount = ContractRegistry.calculateFundingAmount(vault.contractBalance, fundingRate);
                SynthRegistry.applyPerpetualSwapFunding(vaultId, contractId, fundingAmount);
            }
        }

        // Save changes
        await TallyMap.save();
        await marginMap.save();
        await SynthRegistry.saveVaults();
    }

    static calculateFundingAmount(contractSize, fundingRate) {
        return contractSize * fundingRate;
    }


    // Calculate the average price from oracle data
    static calculateAveragePrice(oracleData) {
        if (!oracleData || oracleData.length === 0) return 0;

        const total = oracleData.reduce((acc, data) => acc + data.price, 0);
        return total / oracleData.length;
    }

    // Save funding event for a contract
    static async saveFundingEvent(contractId, fundingRate, blockHeight) {
        const dbInstance = require('./db.js');
        const fundingEvent = { contractId, fundingRate, blockHeight };
        await dbInstance.getDatabase('fundingEvents').insertAsync(fundingEvent);
    }

    // Load funding events for a contract
    static async loadFundingEvents(contractId) {
        const dbInstance = require('./db.js');
        const fundingEvents = await dbInstance.getDatabase('fundingEvents').findAsync({ contractId: contractId });
        return fundingEvents.map(doc => doc);
    }
}

// Usage:

/*const oracleContracts = registry.getContractsByOracle(5); 

const propertyContracts = registry.getContractsByProperties(1, 2);*/

module.exports = ContractRegistry;