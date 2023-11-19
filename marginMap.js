const level = require('level');

// Assuming the LevelDB database is stored at './path_to_margin_db'
const db = level('./path_to_margin_db');

class MarginMap {
  constructor(seriesId) {
    this.seriesId = seriesId;
    this.margins = new Map();
  }

  initMargin(address, contracts, price) {
    const notional = contracts * price;
    const margin = notional * 0.1;
    
    this.margins.set(address, {
      contracts,
      margin,
      unrealizedPl: 0
    });

    return margin;
  }

  updateMargin(address, newContracts, price) {
    const pos = this.margins.get(address);
    
    if (!pos) {
      return this.initMargin(address, newContracts, price); 
    }
    
    const newNotional = newContracts * price;
    const oldNotional = pos.contracts * price;
    
    const addedMargin = Math.abs(newNotional - oldNotional) * 0.1;
    
    pos.contracts = newContracts;
    pos.margin += addedMargin;
    
    return addedMargin;
  }

    updateContractBalances(address, amount, price, isBuyOrder) {
      const position = this.margins.get(address) || this.initMargin(address, 0, price);

      // For buy orders, increase contracts and adjust margin
      if (isBuyOrder) {
        position.contracts += amount;
        const additionalMargin = this.calculateMarginRequirement(amount, price);
        position.margin += additionalMargin;
      }
      // For sell orders, decrease contracts and adjust margin
      else {
        position.contracts -= amount;
        const reducedMargin = this.calculateMarginRequirement(amount, price);
        position.margin -= reducedMargin;
      }

      // Ensure the margin doesn't go below zero
      position.margin = Math.max(0, position.margin);

      // Update the margin map
      this.margins.set(address, position);
    }

    calculateMarginRequirement(contracts, price) {
      // Calculate the margin requirement for a given number of contracts at a specific price
      const notional = contracts * price;
      return notional * 0.1; // Example: 10% of the notional value
    }


  realizePnl(address, contracts, price, avgPrice) {
    const pos = this.margins.get(address);
    
    if (!pos) return 0;
    
    const pnl = (avgPrice - price) * contracts;
    
    pos.margin -= Math.abs(pnl); 
    pos.unrealizedPl += pnl;
    
    return pnl;
  }
  
  clear(price) {
    for (let [address, pos] of this.margins) {
      const upnl = (price - pos.avgPrice) * pos.contracts;
      
      pos.unrealizedPl = upnl;
    }
  }



  // add save/load methods
  saveMarginMap(currentBlockHeight) {
    const key = JSON.stringify({
      seriesId: this.seriesId,
      block: currentBlockHeight 
    });
    
    const value = JSON.stringify([...this.margins]);

    return new Promise((resolve, reject) => {
      db.put(key, value, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  static loadMarginMap(seriesId, block) {
    const key = JSON.stringify({ seriesId, block });
    
    return new Promise((resolve, reject) => {
      db.get(key, (err, value) => {
        if (err) {
          if (err.type === 'NotFoundError') {
            resolve(new MarginMap(seriesId)); // Return a new instance if not found
          } else {
            return reject(err);
          }
        }
        
        const map = new MarginMap(seriesId);
        map.margins = new Map(JSON.parse(value));
        resolve(map);
      });
    });
  },

  static async triggerLiquidations(contract) {
        // Logic to handle the liquidation process
        // This could involve creating liquidation orders and updating the contract's state

        // Example:
        const liquidationOrders = this.generateLiquidationOrders(contract);
        await this.saveLiquidationOrders(contract, liquidationOrders);

        // Update the contract's state as needed
        // Example: contract.state = 'liquidating';
        await ContractsRegistry.updateContractState(contract);

        return liquidationOrders;
    },

    static generateLiquidationOrders(contract) {
        // Logic to generate liquidation orders
        // Example: return [{...}, {...}]; // Array of order objects
    },

    static async saveLiquidationOrders(contract, orders) {
        // Logic to save liquidation orders to the database or in-memory structure
        // Example: await db.put(`liquidationOrders-${contract.id}`, JSON.stringify(orders));
    },

    static needsLiquidation(contract) {
        // Logic to determine if liquidation is needed
        // This could involve checking margin levels, market prices, etc.

        // Example:
        const marginLevel = this.getMarginLevel(contract);
        const marketPrice = this.getMarketPrice(contract);

        // Assuming a simple threshold for liquidation
        return marginLevel < marketPrice * someThresholdFactor;
    },

    static getMarginLevel(contract) {
        // Logic to calculate the margin level of the contract
        // Example: return marginData[contract.id].level;
    },

    static getMarketPrice(contract) {
        // Logic to get the current market price of the contract
        // Example: return marketData[contract.id].price;
    }
  
}

module.exports=MarginMap