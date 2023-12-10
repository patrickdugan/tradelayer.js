const contractListDB = require('./db')

class ContractsRegistry {

  constructor() {
    this.nextOracleSeriesId = 1; 
    this.nextNativeSeriesId = 1;
    
    this.oracleSeriesIndex = {};
    this.nativeSeriesIndex = {};
    this.contractSeries = new Map(); // To store contract series information
        // Load existing contract series from the database
    this.loadContractSeries();
  }

  async loadContractSeries() {
        // Load the contract series data from the database
        try {
            const seriesDataJSON = await this.contractListDB.get('contractSeries');
            this.contractSeries = new Map(JSON.parse(seriesDataJSON));
        } catch (error) {
            if (error.type === 'NotFoundError') {
                this.contractSeries = new Map(); // Initialize if not found
            } else {
                console.error('Error loading contract series data:', error);
            }
        }
    }

    createContractSeries(contractId, type, properties) {
        if (this.contractSeries.has(contractId)) {
            throw new Error(`Contract series with ID ${contractId} already exists.`);
        }
        this.contractSeries.set(contractId, {
            type,
            properties
        });
        this.saveContractSeries(); // Save the updated state
    }

    async saveContractSeries() {
        const seriesDataJSON = JSON.stringify([...this.contractSeries]);
        await this.db.put('contractSeries', seriesDataJSON);
    }

  // ...generate series IDs and create contract methods...

  loadContractsFromDb() {
    return new Promise((resolve, reject) => {
      db.createReadStream()
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

  // In ContractsRegistry

    getContractsSameOracle(oracleId) {
      const contracts = [];

      for (let seriesId in this.oracleSeriesIndex) {
        for (let contract of this.oracleSeriesIndex[seriesId]) {
          if (contract.oracleId === oracleId) {
            contracts.push(contract);
          }
        }
      }

      return contracts; 
    }

    getContractsSameNativeIndex(notionalPropId, collateralPropId) {

      const contracts = [];

        for (let seriesId in this.nativeSeriesIndex) {

            for (let contract of this.nativeSeriesIndex[seriesId]) {
          
              // Handle single data array 
              if (Array.isArray(contract.dataIndex)) {
                if (contract.dataIndex[0] === notionalPropId && 
                  contract.dataIndex[1] === collateralPropId) {
                contracts.push(contract);
              }
            } 
          
          // Handle multiple equal-weighted arrays
          else if (Array.isArray(contract.dataIndex[0])) {
            let match = true;
            
            for (let dataPair of contract.dataIndex) {
              if (!(dataPair[0] === notionalPropId && 
                    dataPair[1] === collateralPropId)) {
                match = false;
                break;
              }
            }
            
            if (match) {
              contracts.push(contract);
            }
          }
        }
      }

      return contracts;
    }

  saveContractsToDb() {
    const batch = [];

    for (let [seriesId, contracts] of Object.entries(this.oracleSeriesIndex)) {
      batch.push({ 
        type: 'put',
        key: JSON.stringify({ type: 'oracle', seriesId }),
        value: JSON.stringify(contracts)
      });
    }

    for (let [seriesId, contracts] of Object.entries(this.nativeSeriesIndex)) {
      batch.push({
        type: 'put', 
        key: JSON.stringify({ type: 'native', seriesId }),
        value: JSON.stringify(contracts)  
      });
    }

    return new Promise((resolve, reject) => {
      db.batch(batch, err => {
        if (err) return reject(err);
        resolve();  
      });
    });
  }

  // ContractsRegistry

    saveIndexesToDb() {

      const oracleIndex = {};

      for (let seriesId in this.oracleSeriesIndex) {
        oracleIndex[seriesId] = this.oracleSeriesIndex[seriesId]; 
      }

      const nativeIndex = {};

      for (let seriesId in this.nativeSeriesIndex) {
        nativeIndex[seriesId] = this.nativeSeriesIndex[seriesId];
      }

      const batch = [
        { 
          type: 'put',
          key: 'oracleContracts',
          value: JSON.stringify(oracleIndex)
        },
        {
          type: 'put',  
          key: 'nativeContracts',
          value: JSON.stringify(nativeIndex)
        }
      ];

      return new Promise((resolve, reject) => {
        db.batch(batch, err => {
          if (err) return reject(err);
          resolve();
        }); 
      });

    }

    loadIndexesFromDb() {
      return new Promise((resolve, reject) => {
        db.get('oracleContracts', (err, oracleValue) => {
          if (err) return reject(err); 

          this.oracleSeriesIndex = JSON.parse(oracleValue);

          db.get('nativeContracts', (err, nativeValue) => {
            if (err) return reject(err);

            this.nativeSeriesIndex = JSON.parse(nativeValue);  
            resolve();
          });
        });
      });
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