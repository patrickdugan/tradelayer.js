const data = require('./db.js');


const Scaling = {
    // Check if a settlement has already been neutralized
    async isThisSettlementAlreadyNeutralized(channel, txid) {
        const settlements = await this.getFileByChannel(txid, channel);
        
        // If settlements is undefined or empty, no settlement has been recorded yet
        if (!settlements || settlements.length === 0) {
            return false; // Return false if no settlements found
        }

        // Loop through settlements array to check if the txid exists and is neutralized
        for (const settlement of settlements) {
            if (settlement.txid === txid && settlement.status=='neutralized') {
                return true; // Return true if the txid is found and is neutralized
            }
        }

        return false; // Return false if txid is not found or not neutralized
    },

    // Mark a settlement as neutralized
    async neutralizeSettlement(channel, txid){
        let settlements = await this.getFileByChannel(channel, txid);
        let settlement = null 
        for(const item of settlements){
            if (item.txid === txid && item.status=='neutralized') {
                settlement=item; // Return true if the txid is found and is neutralized
            }
        }
        if (settlement==null) {
            settlement = {txid: txid, status: 'neutralized' };
        } else {
            settlement.status = "neutralized";
        }
        await this.recordTransaction(channel,settlement);
    },

    // Check if a trade has been published or if it's in a certain status (live, expired, unpublished)
    async isTradePublished(txidNeutralized1){
        const trade = await this.getTradeByTxid(txidNeutralized1);
        if (!trade) {
            return { status: "unpublished" };
        } else if (trade.expired && trade.type === "contract") {
            return { status: "expiredContract", params: trade };
        } else if (trade.expired && trade.type === "token") {
            return { status: "expiredToken", params: trade };
        } else {
            return { status: trade.live ? "liveContract" : "liveToken", params: trade };
        }
    },

    // Put settlement into a limbo state if trade is not yet published
    async settlementLimbo(channel, txid) {
        const limbo = { txid, status: "pending" };
        await this.saveSettlement(channel, limbo);
    },

    // Generate an offset based on the trade parameters and the current mark price
    generateOffset(tradeParams, markPrice) {
        // Assume some logic here to calculate the offset based on the markPrice vs original trade price
        const offsetAmount = calculatePNL(tradeParams, markPrice);
        const offsetParams = { ...tradeParams, adjustedAmount: offsetAmount };
        return { params: offsetParams };
    },

    // Query prior settlements related to the transaction for chaining logic
    async queryPriorSettlements(txidNeutralized1, txidNeutralized2, channelAddress) {
        // Assume logic here to look up prior settlements in the same channel
        const settlements = await this.getFileByChannel(txidNeutralized1, channelAddress);
        return settlements;
    },

    // Settle the PNL based on the mark price and previous settlements
    async settlePNL(lastSettlement, markPrice, txidNeutralized1) {
        const lastPrice = lastSettlement ? lastSettlement.markPrice : null;
        const pnlAmount = calculatePNL({ previousPrice: lastPrice, markPrice });
        
        // Store the final settlement
        const finalSettlement = { txid: txidNeutralized1, markPrice, pnlAmount };
        await this.saveSettlement(finalSettlement);
        
        return finalSettlement;
    },

    // Helper function to get a settlement by its txid
    async getSettlementByTxid(channel, txid) {
        // Assume logic to get settlement from the database
        const db = await data.getDatabase('scaling');
        return await db.findOneAsync({ txid });
    },


// Function to update a specific part of the document
    async recordTransaction(channelAddress, txid, txType, status) {
        // Fetch the full document or initialize a new one if it doesn't exist
        let scalingData = await scalingDb.findOneAsync({ _id: channelAddress }) || {
            _id: channelAddress,
            contractTrades: [],
            tokenTrades: [],
            settlements: [],
            misc: []
        };

        // Determine the transaction type and update the appropriate array
        switch (txType) {
            case 19:  // Contract trade
                scalingData.contractTrades.push({ txid: txid, status: status });
                break;
            case 20:  // Token trade
                scalingData.tokenTrades.push({ txid: txid, status: status });
                break;
            case 23:  // Settlement
                scalingData.settlements.push({ txid: txid, status: status });
                break;
            default:  // Miscellaneous transactions
                scalingData.misc.push({ txid: txid, status: status });
                break;
        }

        // Save or update the document in the database
        await scalingDb.updateAsync({ _id: channelAddress }, scalingData, { upsert: true });
    },

    // Helper function to get settlements based on txid and channel
    async getFileByChannel(channelAddress, type) {
        const db = await data.getDatabase('scaling');
        const query = { _id: channelAddress }; // Searching by channelAddress
        const doc = await db.findOneAsync(query);

        // If no doc or settlements exist for the channel, return an empty array
        return doc && doc.settlements ? doc.settlements : [];
    },

// Mock function to calculate PNL (replace with your actual logic)
    calculatePNL({ previousPrice, markPrice }) {
        // Simple PNL calculation, replace with actual formula
        return markPrice - previousPrice;
    }

};

module.exports = Scaling;
