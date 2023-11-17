const level = require('level');
const db = level('contracts');

class ContractsRegistry {

  constructor() {
    this.nextOracleSeriesId = 1; 
    this.nextNativeSeriesId = 1;
    
    this.oracleSeriesIndex = {};
    this.nativeSeriesIndex = {};
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

}

// Usage:

const oracleContracts = registry.getContractsByOracle(5); 

const propertyContracts = registry.getContractsByProperties(1, 2);

module.exports = new ContractsRegistry();