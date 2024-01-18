const database = require('./db.js')

class TradeHistory {
  constructor() {
    this.tradeHistoryDb = database.getDatabase('tradeHistory');
  }

  async loadTradeHistory(contractId) {
    let key = { "key": "contract-" + contractId }
    console.log('key to load trades ' +JSON.stringify(key))
    return this.tradeHistoryDb.findAsync(key);
  }

  async getTradeHistoryForAddress(address,contractId) {
    console.log('about to call load history for contract '+contractId)
    const tradeHistory = await this.loadTradeHistory(contractId);
    //console.log('loading the whole trade history for everything ' +JSON.stringify(tradeHistory))
    return tradeHistory.filter((trade) =>
      [trade.trade.buyerAddress, trade.trade.sellerAddress].includes(address)
    );
  }

  async getPositionHistoryForContract(address, contractId) {
    //console.log('about to call trade history for contract '+contractId)
    const addressTradeHistory = await this.getTradeHistoryForAddress(address,contractId);
    addressTradeHistory.sort((a, b) => a.blockHeight - b.blockHeight);

    //console.log('filtered trade history for address  '+address+  '  ' +JSON.stringify(addressTradeHistory))
    const positionHistory = [];
    var position = 0

    for (const trade of addressTradeHistory) {
      //console.log(JSON.stringify(trade))
      if (trade.trade.contractId === contractId) {
        if(trade.trade.sellerAddress==address){
          trade.trade.amount *= -1
        }
        // Check if the trade is a close
        const isClose = Math.abs(position) > Math.abs(position + trade.trade.amount);
        //console.log(Math.abs(position) + ' '+ Math.abs(position +trade.trade.amount))
        position = position + trade.trade.amount

        const snapshot = {
          amount: position,
          price: trade.trade.price,
          blockHeight: trade.blockHeight,
          isClose: isClose
        };
        //console.log(snapshot)
        positionHistory.push(snapshot);

      }
    }
    //console.log(positionHistory)
    return positionHistory;
  }

  async getTxIdsForContract(address, contractId, action) {
    const addressTradeHistory = await this.getTradeHistoryForAddress(address);
    const txIds = [];

    for (const trade of addressTradeHistory) {
      if (trade.trade.contractId === contractId && trade.trade.buyerAddress === address) {
        txIds.push({
          txId: trade.trade.buyerTx, 
          blockHeight: trade.blockHeight,
        });
      }else if(trade.trade.contractId === contractId && trade.trade.sellerAddress === address){
        txIds.push({
          txId: trade.trade.sellerTx, 
          blockHeight: trade.blockHeight,
        });
      }
    }

    return txIds;
  }

    async getCategorizedTrades(address, contractId) {
      const trades = await this.getPositionHistoryForContract(address, contractId);

      const openTrades = [];
      const partiallyClosedTrades = [];
      const closedTrades = [];

      for (let i = 0; i < trades.length; i++) {
          const currentTrade = trades[i];

          if (i === 0) {
              openTrades.push(currentTrade);
          } else {
              const prevTrade = trades[i - 1];

              const tradedAmount = currentTrade.amount - prevTrade.amount;

              // Update the trade object with the tradedAmount
              currentTrade.tradedAmount = tradedAmount;

              if (tradedAmount === 0) {
                  partiallyClosedTrades.push(currentTrade);
              } else {
                  if (currentTrade.isClose) {
                      closedTrades.push(currentTrade);
                  } else {
                      openTrades.push(currentTrade);
                  }
              }
          }
      }

      return {
          openTrades,
          partiallyClosedTrades,
          closedTrades,
      };
  }


  async calculateLIFOEntry(address, amount, contractId) {
      const categorizedTrades = await this.getCategorizedTrades(address, contractId);
      console.log('open trades ' +JSON.stringify(categorizedTrades.openTrades));

      // Sort trades by block height in descending order (LIFO)
      categorizedTrades.openTrades.sort((a, b) => b.blockHeight - a.blockHeight);

      // Calculate the LIFO entry based on the sorted trades
      let remainingAmount = Math.abs(amount);
      let totalCost = 0;
      const blockTimes = [];

      for (const trade of categorizedTrades.openTrades) {
        const tradeAmount = Math.abs(trade.tradedAmount);
        const tradeCost = tradeAmount * trade.price;
        console.log('old open trade ' +JSON.stringify(trade)+ ' '+totalCost)
        if (tradeAmount <= remainingAmount) {
          // Fully cover the remaining amount with the current trade
          totalCost += tradeCost;
          remainingAmount -= tradeAmount;
          blockTimes.push(trade.blockHeight); // Add block time of the closing trade
        } else {
          // Partially cover the remaining amount with the current trade
          totalCost += (remainingAmount / tradeAmount) * tradeCost;
          remainingAmount = 0;
          blockTimes.push(trade.blockHeight); // Add block time of the closing trade
        }

        if (remainingAmount === 0) {
          // Fully covered the given amount
          break;
        }
      }

      // Return an object with total cost and block times
      return {
        totalCost,
        blockTimes,
      };
    }

    /**
     * Save PNL data to the trade history database.
     *
     * @param {number} currentBlockHeight - The current block height.
     * @param {string} contractId - The contract ID associated with the trade.
     * @param {number} accountingPNL - The accounting PNL value.
     * @param {string} buyerAddress - The address of the buyer.
     * @param {number} orderAmount - The amount in the buy order.
     * @param {number} orderPrice - The price in the buy order.
     * @param {string} collateralPropertyId - The ID of the collateral property.
     * @param {string} timestamp - The timestamp of the trade.
     * @param {string} buyerTx - The buyer's transaction ID.
     * @param {number} settlementPNL - The settlement PNL value.
     * @param {number} reduction - The reduction value.
     * @param {object} LIFO - The LIFO data object.
     * @returns {Promise<string>} - A Promise that resolves to the key under which the data is saved.
     */
    async savePNL(params) {
      // Assuming tradeHistoryManager is an instance of a database manager or similar
      // Adjust the following code based on your actual database handling implementation

      // Assuming rPNL-address-contractId-block is the key structure you want to use
      const key = `rPNL-${params.address}-${params.contractId}-${params.height}`;
      console.log('preparing to save PNL '+JSON.stringify(params))

      // Assuming tradeHistoryManager.save is a method to save data to the database
      await this.save(key, params);

      // Optionally, you can return the key or any other relevant information
      return key;
    }

     /**
       * Save data to the trade history database.
       *
       * @param {string} key - The key under which to save the data.
       * @param {object} data - The data to be saved.
       * @returns {Promise<void>} - A Promise that resolves once the data is saved.
       */
      async save(key, data) {
        try {
          const db = database.getDatabase('tradeHistory');
          const value = JSON.stringify(data);

          console.log(`updating tradeHistoryDB with ${value}`);

          // Save the data to the database
          await db.updateAsync({ _id: key }, { $set: { value } }, { upsert: true });

          console.log(`tradeHistoryDB saved successfully.`);
        } catch (err) {
          console.error(`Error saving tradeHistory rPNL:`, err);
          throw err;
        }
      }

    async displayPositionHistory(address, contractId) {
      const positionHistory = this.getPositionHistoryForContract(address, contractId);
      console.log(`Position History for Address ${address} and Contract ID ${contractId}:`);
      console.table(positionHistory);
    }
}

module.exports = TradeHistory;