const { dbFactory } = require('./db.js')

class TradeHistory {

    constructor(db) {
        this.db = db
    }

    async _find(exp) {
        return await this.db.findAsync(exp)
    }

    async getContractHistory(contractId) {
        return await this._find({ key: `contract-${contractId}` })
    }

    async getTokenHistory(pid1, pid2) {
        return await this._find({ key: `token-${pid1}-${pid2}` })
    }

    async getHistoryByAddress(address, contractId) {
        return await this._find({
            $and: [{ key: `contract-${contractId}` },
            { $or: [{ 'trade.sellerAddress': address }, { 'trade.buyerAddress': address }] }
            ]
        })
    }

    async getPositionHistory(address, contractId) {
        let history = await this.getHistoryByAddress(address, contractId)
        history.sort((a, b) => a.blockHeight - b.blockHeight)

        const positionHistory = []
        let position = 0

        for (const h of history) {
            if (h.trade.sellerAddress == address) {
                h.trade.amount *= -1
            }

            //console.log(Math.abs(position) + ' '+ Math.abs(position +trade.trade.amount))
            const isClose = Math.abs(position) > Math.abs(position + h.trade.amount)
            position = position + h.trade.amount

            const snapshot = {
                amount: position,
                price: h.trade.price,
                blockHeight: h.blockHeight,
                isClose: isClose
            }

            //console.log(snapshot)
            positionHistory.push(snapshot)
        }

        //console.log(positionHistory)
        return positionHistory
    }

    async getTxIdsForContract(address, contractId) {
        const history = await this.getHistoryByAddress(address, contractId)
        const txIds = []

        for (const h of history) {
            const txid = h.trade.buyerAddress === address ? h.trade.buyerTx : h.trade.sellerTx
            txIds.push({
                txId: txid,
                blockHeight: h.blockHeight,
            })
        }
        return txIds
    }

    async getCategorizedTrades(address, contractId) {
        const openTrades = [];
        const partiallyClosedTrades = [];
        const closedTrades = [];

        const trades = await this.getPositionHistory(address, contractId)
  
        for (let i = 0; i < trades.length; i++) {
            const currentTrade = trades[i];
  
            if (i === 0) {
                openTrades.push(currentTrade)
            } else {
                const prevTrade = trades[i - 1]
  
                const tradedAmount = currentTrade.amount - prevTrade.amount
  
                // Update the trade object with the tradedAmount
                currentTrade.tradedAmount = tradedAmount;
  
                if (tradedAmount === 0) {
                    partiallyClosedTrades.push(currentTrade)
                } else {
                    if (currentTrade.isClose) {
                        closedTrades.push(currentTrade)
                    } else {
                        openTrades.push(currentTrade)
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
        const ct = await this.getCategorizedTrades(address, contractId)

        //console.log(ct.openTrades.length)

        // Sort trades by block height in descending order (LIFO)
        ct.openTrades.sort((a, b) => b.blockHeight - a.blockHeight)

        // Calculate the LIFO entry based on the sorted trades
        let remainingAmount = Math.abs(amount)
        let totalCost = 0;
        const blockTimes = []

        for (const trade of ct.openTrades) {
            const tradeAmount = Math.abs(trade.tradedAmount)
            const tradeCost = tradeAmount * trade.price;

            //console.log('old open trade ' + JSON.stringify(trade) + ' ' + totalCost)

            if (tradeAmount <= remainingAmount) {
                // Fully cover the remaining amount with the current trade
                totalCost += tradeCost;
                remainingAmount -= tradeAmount;
                blockTimes.push(trade.blockHeight) // Add block time of the closing trade
            } else {
                // Partially cover the remaining amount with the current trade
                totalCost += (remainingAmount / tradeAmount) * tradeCost;
                remainingAmount = 0;
                blockTimes.push(trade.blockHeight) // Add block time of the closing trade
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
        }
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
    async savePNL(
        currentBlockHeight,
        contractId,
        accountingPNL,
        buyerAddress,
        orderAmount,
        orderPrice,
        collateralPropertyId,
        timestamp,
        buyerTx,
        settlementPNL,
        reduction,
        LIFO) {
        // Assuming tradeHistoryManager is an instance of a database manager or similar
        // Adjust the following code based on your actual database handling implementation
        // Assuming rPNL-address-contractId-block is the key structure you want to use
        const key = `rPNL-${buyerAddress}-${contractId}-${currentBlockHeight}`;

        // Assuming tradeHistoryManager.save is a method to save data to the database
        await this.save(key, {
            currentBlockHeight,
            contractId,
            accountingPNL,
            buyerAddress,
            orderAmount,
            orderPrice,
            collateralPropertyId,
            timestamp,
            buyerTx,
            settlementPNL,
            reduction,
            LIFO,
        })

        // Optionally, you can return the key or any other relevant information
        return key
    }

    async save(key, value) {
        await this.db.updateAsync(
            { _id: key },
            { $set: value },
            { upsert: true }
        )
    }

    async displayPositionHistory(address, contractId) {
        const h = await this.getPositionHistory(address, contractId)
        console.table(h)
    }
}

exports.tradeHistory = new TradeHistory(dbFactory.getDatabase('tradeHistory'))
