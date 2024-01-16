const database = require('./db.js')

class TradeHistoryManager {
  constructor() {
    this.tradeHistoryDb = database.getDatabase('tradeHistory');
  }

  async loadTradeHistory() {
    return this.tradeHistoryDb.findAsync({ "key": "contract-1" });
  }

  async getTradeHistoryForAddress(address) {
    const tradeHistory = await this.loadTradeHistory();
    console.log('loading the whole trade history for everything ' +JSON.stringify(tradeHistory))
    return tradeHistory.filter((trade) =>
      [trade.trade.buyerAddress, trade.trade.sellerAddress].includes(address)
    );
  }

  async getPositionHistoryForContract(address, contractId) {
    const addressTradeHistory = await this.getTradeHistoryForAddress(address);
    console.log('filtered trade history for address  '+address+  '  ' +JSON.stringify(addressTradeHistory))
    const positionHistory = [];

    for (const trade of addressTradeHistory) {
      if (trade.trade.contractId === contractId) {
        const position = {
          amount: trade.trade.amount,
          price: trade.trade.price,
          blockHeight: trade.blockHeight,
        };
        positionHistory.push(position);
      }
    }

    return positionHistory;
  }

  async getTxIdsForContract(address, contractId, action) {
    const addressTradeHistory = await this.getTradeHistoryForAddress(address);
    const txIds = [];

    for (const trade of addressTradeHistory) {
      if (trade.trade.contractId === contractId && trade.trade.action === action) {
        txIds.push({
          txId: trade.trade.buyerTx || trade.trade.sellerTx,
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

  async displayPositionHistory(address, contractId) {
    const positionHistory = this.getPositionHistoryForContract(address, contractId);
    console.log(`Position History for Address ${address} and Contract ID ${contractId}:`);
    console.table(positionHistory);
  }
}

module.exports = TradeHistoryManager;