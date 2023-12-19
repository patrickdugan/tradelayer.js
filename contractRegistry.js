const db = require('./db')



const path = require('path');
const util = require('util');

class ContractsRegistry {
    constructor() {
        // ... Other initializations ...
        this.contractsList = new Map()

        this.loadContractSeries();
    }

    async loadContractSeries() {
        try {
            const docs = await db.getDatabase('contractList').findAsync({ type: 'contractSeries' });
            this.contractSeries = new Map(docs.map(doc => [doc.id, doc.data]));
        } catch (error) {
            console.error('Error loading contract series data:', error);
        }
    }

    
    async createContractSeries(params) {
        // Generate a unique ID for the new contract series
        const seriesId = await this.getNextId();

        // Create the contract series object
        const contractSeries = {
            id: seriesId,
            underlyingOracleId: params.underlyingOracleId,
            onChainData: params.onChainData,
            notionalPropertyId: params.notionalPropertyId,
            notionalValue: params.notionalValue,
            collateralPropertyId: params.collateralPropertyId,
            inverse: params.inverse,
            fee: params.fee,
            contracts: {
                expired: [],
                unexpired: this.generateContracts(params, seriesId)
            }
        };

        // Save the new contract series to the in-memory map and the database
        this.contractSeries.set(seriesId, contractSeries);
        await this.saveContractSeries();

        console.log(`New contract series created: ID ${seriesId}`);
        return seriesId; // Return the new series ID
    }

    // Generate contracts within the series
    generateContracts(params, seriesId) {
        let contracts = [];
        const currentBlockHeight = this.getCurrentBlockHeight(); // Implement this method to get the current block height
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

    loadContractsFromDb() {
        return new Promise((resolve, reject) => {
          db.getDatabase('contractList').findAsync()
            .on('data', ({ key, value }) => {
               const { type, seriesId } = JSON.parse(key);

               if (type === 'oracle') {
                 this.oracleSeriesIndex[seriesId] = JSON.parse(value);
               } else {
                 this.nativeSeriesIndex[seriesId] = JSON.parse(value);
               }
            })
            .on('error', reject)
            .on('end', resolve);
      });
    }

    async saveContractSeries() {
        // Convert Map to array of objects for storage
        const seriesArray = [...this.contractSeries].map(([id, data]) => ({ id, data, type: 'contractSeries' }));
        await Promise.all(seriesArray.map(series => db.getDatabase('contractList').updateAsync({ id: series.id }, series, { upsert: true })));
    }

    // ... Other methods ...

    async saveIndexesToDb() {
        // Convert indexes to a storable format
        const oracleIndex = Object.entries(this.oracleSeriesIndex).map(([id, data]) => ({ id, data, type: 'oracleContracts' }));
        const nativeIndex = Object.entries(this.nativeSeriesIndex).map(([id, data]) => ({ id, data, type: 'nativeContracts' }));

        await Promise.all([...oracleIndex, ...nativeIndex].map(entry => db.getDatabase('contractList').updateAsync({ id: entry.id }, entry, { upsert: true })));
    }


    async getNextId() {
      let maxId = 0;
      for (const [key, value] of this.registry) {
          const currentId = parseInt(key);
          if (currentId > maxId) {
              maxId = currentId;
          }
      }
      return maxId + 1;
    }

    isValidSeriesId(seriesId) {
        // Check if the seriesId exists in the contract series registry
        // The registry could be a database, a map, or any other data structure
        // that stores information about the contract series in your system
        if (this.contractSeriesRegistry.has(seriesId)) {
            return true; // The seriesId is valid
        } else {
            return false; // The seriesId is not valid
        }
    }

    getAllContracts() {
        let allContracts = [];
        // Add all oracle contracts
        for (const seriesId in this.oracleSeriesIndex) {
            allContracts.push(...this.oracleSeriesIndex[seriesId]);
        }
        // Add all native contracts
        for (const seriesId in this.nativeSeriesIndex) {
            allContracts.push(...this.nativeSeriesIndex[seriesId]);
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
        // Logic to determine the contract type
        // This could involve checking your database or in-memory data structure
        // Example:
        if (this.oracleSeriesIndex[contractId]) {
            return 'oracle';
        } else if (this.nativeSeriesIndex[contractId]) {
            return 'native';
        } else {
            throw new Error("Contract type not found for contract ID: " + contractId);
        }
    }

    static async fetchLiquidationVolume(contractId, blockHeight) {
        // Assuming you have a database method to fetch liquidation data
        try {
            const liquidationData = await db.get(`liquidation-${contractId}-${blockHeight}`);
            return JSON.parse(liquidationData);
        } catch (error) {
            if (error.type === 'NotFoundError') {
                console.log(`No liquidation data found for contract ID ${contractId} at block ${blockHeight}`);
                return null; // Handle case where data is not found
            }
            throw error; // Rethrow other types of errors
        }
    }

    static isNativeContract(contractId) {
        // Check if the contractId exists in the nativeSeriesIndex
        return Boolean(this.nativeSeriesIndex && this.nativeSeriesIndex[contractId]);
    }

    static getContractInfo(contractId) {
        // Fetch contract information from the nativeSeriesIndex or oracleSeriesIndex
        if (this.isNativeContract(contractId)) {
            return this.nativeSeriesIndex[contractId];
        } else if (this.oracleSeriesIndex && this.oracleSeriesIndex[contractId]) {
            return this.oracleSeriesIndex[contractId];
        }
        console.log(`Contract information not found for contract ID: ${contractId}`);
        return null;
    }
}

// Usage:

/*const oracleContracts = registry.getContractsByOracle(5); 

const propertyContracts = registry.getContractsByProperties(1, 2);*/

module.exports = new ContractsRegistry();