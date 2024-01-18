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
    const openTrades = [];
    const partiallyClosedTrades = [];
    const closedTrades = [];

    const positionHistory = await this.getPositionHistoryForContract(address, contractId);

    for (let i = 0; i < positionHistory.length; i++) {
      const currentPosition = positionHistory[i];

      if (i === 0) {
        openTrades.push(currentPosition);
      } else {
        const prevPosition = positionHistory[i - 1];

        if (currentPosition.amount === prevPosition.amount) {
          partiallyClosedTrades.push(currentPosition);
        } else {
          closedTrades.push(currentPosition);
          openTrades.push(currentPosition);
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
    //console.log(JSON.stringify(categorizedTrades))
    // Filter trades where the given amount is involved
    const relevantTrades = categorizedTrades.openTrades.filter(trade =>
      Math.abs(trade.amount) === Math.abs(amount)
    );

    // Sort trades by block height in descending order (LIFO)
    relevantTrades.sort((a, b) => b.blockHeight - a.blockHeight);

    // Calculate the LIFO entry based on the sorted trades
    let remainingAmount = Math.abs(amount);
    let totalCost = 0;
    const blockTimes = [];

    for (const trade of relevantTrades) {
      const tradeAmount = Math.abs(trade.amount);
      const tradeCost = tradeAmount * trade.price;

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

  async displayPositionHistory(address, contractId) {
    const positionHistory = this.getPositionHistoryForContract(address, contractId);
    console.log(`Position History for Address ${address} and Contract ID ${contractId}:`);
    console.table(positionHistory);
  }
}

module.exports = TradeHistory;