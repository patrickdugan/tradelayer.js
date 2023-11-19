const tallyMap = require('tally3.js')
const { getAllContracts, hasOpenPositions, fetchPositionsForAdjustment } = require('./contracts');

class Clearing {
    // ... other methods ...
    constructor() {
        // Access the singleton instance of TallyMap
        this.tallyMap = TallyMap.getSingletonInstance();
        this.balanceChanges = []; // Initialize an array to track balance changes

    },

    async clearingFunction(blockHeight) {
        console.log(`Starting clearing operations for block ${blockHeight}`);

        // 1. Fee Cache Buy
        await this.feeCacheBuy();

        // 2. Update last exchange block in channels
        await this.updateLastExchangeBlock(blockHeight);

        // 3. Calculate and update UPNL (Unrealized Profit and Loss)
        await this.calculateAndUpdateUPNL(blockHeight);

        // 4. Create channels for new trades
        await this.createChannelsForNewTrades(blockHeight);

        // 5. Set channels as closed if needed
        await this.closeChannelsIfNeeded();

        // 6. Settle trades at block level
        await this.makeSettlement(blockHeight);

        console.log(`Clearing operations completed for block ${blockHeight}`);
    },

    // Define each of the above methods with corresponding logic based on the C++ functions provided
    // ...

    async feeCacheBuy() {
        console.log('Processing fee cache buy');

        // Fetch fees from your data source (e.g., database or in-memory store)
        let fees = await this.fetchFees();

        // Process each fee category
        fees.forEach(fee => {
            // Implement logic to use these fees
            // For example, converting fees to another form, distributing them, etc.
        });

        // Save any changes back to your data source
        await this.saveFees(fees);
    },

   async updateLastExchangeBlock(blockHeight) {
        console.log('Updating last exchange block in channels');

        // Fetch the list of active channels
        let channels = await this.getActiveChannels();

        // Update the last active block for each channel
        channels.forEach(channel => {
            if (channel.isActive) {
                channel.lastExchangeBlock = blockHeight;
            }
        });

        // Save the updated channel information
        await this.saveChannels(channels);
    },


    async calculateAndUpdateUPNL(blockHeight) {
        console.log('Calculating and updating UPNL');

        // Fetch trade data relevant to UPNL calculations
        let trades = await this.fetchTradesForUPNL();

        // Calculate UPNL for each trade
        trades.forEach(trade => {
            let upnl = this.calculateUPNL(trade, blockHeight);
            trade.upnl = upnl;
        });

        // Save the updated trade data
        await this.saveTrades(trades);
    },

    async createChannelsForNewTrades(blockHeight) {
        //console.log('Creating channels for new trades');

        // Fetch new trades from the block
        let newTrades = await this.fetchNewTrades(blockHeight);

        // Create channels for each new trade
        newTrades.forEach(trade => {
            let channel = this.createChannelForTrade(trade);
            // Save the new channel
            this.saveChannel(channel);
        });
    },

    async closeChannelsIfNeeded() {
        console.log('Closing channels if needed');

        // Fetch all active channels
        let channels = await this.getActiveChannels();

        // Check each channel for closing conditions
        channels.forEach(channel => {
            if (this.shouldCloseChannel(channel)) {
                channel.close();
                // Perform any additional clean-up or notifications required
            }
        });

        // Save the updated state of channels
        await this.saveChannels(channels);
    },

    async makeSettlement(blockHeight) {
        console.log('Making settlement for positions at block height:', blockHeight);

        // Fetch positions that need adjustment
        let positions = await this.fetchPositionsForAdjustment(blockHeight);

        // Update margin maps based on mark prices and current contract positions
        await this.updateMarginMaps(blockHeight);

        // Iterate through each position to adjust for profit or loss
        for (let position of positions) {
            // Calculate the unrealized profit or loss based on the new mark price
            let pnlChange = this.calculatePnLChange(position, blockHeight);

            // Adjust the balance based on the P&L change
            if (pnlChange !== 0) {
                await this.adjustBalance(position.holderAddress, pnlChange);
            }
        }

        // Perform additional tasks like loss socialization if needed
        await this.performAdditionalSettlementTasks(blockHeight, positions);

        // Save the updated position information
        await this.savePositions(positions);
        return [positions, this.balanceChanges];
    },

    // Additional functions to be implemented
    async fetchPositionsForAdjustment(blockHeight) {
        try {
            let marginMap = await MarginMap.loadMarginMap(this.seriesId, blockHeight);

            let positions = Array.from(marginMap.margins.entries()).map(([address, positionData]) => ({
                address,
                contracts: positionData.contracts, // Ensure this reflects the actual structure of positionData
                ...positionData
            }));

            return positions;
        } catch (error) {
            console.error('Error fetching positions for adjustment:', error);
            throw error;
        }
    },

    calculatePnLChange(position, blockHeight) {
        // Retrieve the current and previous mark prices for the block height
        let currentMarkPrice = this.getCurrentMarkPrice(blockHeight);
        let previousMarkPrice = this.getPreviousMarkPrice(blockHeight);

        // Calculate the price change per contract
        let priceChangePerContract = currentMarkPrice - previousMarkPrice;

        // Calculate P&L change for the position based on the number of contracts
        // Assuming a long position benefits from a price increase and vice versa
        let pnlChange = position.contracts * priceChangePerContract;

        // Adjust sign based on whether the position is long or short
        pnlChange *= position.isLong ? 1 : -1; // Assuming position.isLong is a boolean indicating position type

        return pnlChange;
    },

    async adjustBalance(holderAddress, pnlChange) {
        try {
            // Assuming you have a defined propertyId for the type of balance being adjusted
            const propertyId = this.getPropertyIdForPnL(); 

            // Fetch the current balance details
            let balanceDetails = this.tallyMap.getAddressBalances(holderAddress);

            // Assuming balanceDetails includes the fields 'available' and 'reserved'
            let available = balanceDetails.available || 0;
            let reserved = balanceDetails.reserved || 0;

            // Adjust available balance based on P&L change
            available += pnlChange;

            // Update the balance in TallyMap
            this.tallyMap.updateBalance(holderAddress, propertyId, available, reserved);
            this.balanceChanges.push({
                blockHeight: this.currentBlockHeight, // Assuming this is set appropriately
                holderAddress: holderAddress,
                pnlChange: pnlChange
            });

            // Optionally, you can save the TallyMap state to the database
            await this.tallyMap.save(someBlockHeight); // Replace someBlockHeight with the appropriate block height
        } catch (error) {
            console.error('Error adjusting balance for address:', holderAddress, error);
            throw error;
        }
    },

    async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress);
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error);
            throw error;
        }
    },

    async performAdditionalSettlementTasks(blockHeight, positions) {
        try {
            // Step 1: Calculate total losses
            const totalLoss = this.getTotalLoss(positions);

            // Step 2: Check if insurance fund payout is needed
            if (totalLoss > 0) {
                // Step 3: Apply insurance fund payout
                const payout = await this.insuranceFund.applyPayout(totalLoss);

                // Step 4: Socialize remaining loss if any
                const remainingLoss = totalLoss - payout;
                if (remainingLoss > 0) {
                    await this.socializeLoss(remainingLoss, positions);
                }
            }
        } catch (error) {
            console.error('Error performing additional settlement tasks:', error);
            throw error;
        }
    }


    async auditSettlementTasks(blockHeight, positions) {
        try {
            // Check total margin consistency
            let totalMargin = this.calculateTotalMargin(positions);
            if (!this.isMarginConsistent(totalMargin)) {
                throw new Error("Inconsistent total margin detected");
            }

            // Verify insurance fund balance is not negative
            if (this.insuranceFund.getBalance() < 0) {
                throw new Error("Negative balance in the insurance fund");
            }

            // Save index populated during balance adjustment
            await this.saveAuditIndex(blockHeight);
        } catch (error) {
            console.error('Audit error at block height', blockHeight, ':', error);
            throw error;

             // Check for the consistency of balance updates
        let balanceUpdates = this.fetchBalanceUpdatesForSettlement();
            if (!this.areBalanceUpdatesConsistent(balanceUpdates)) {
                throw new Error("Inconsistent balance updates detected");
            }

                // Save audit data
                const auditData = this.prepareAuditData(); 
                await this.saveAuditData(blockHeight, auditData);
            } catch (error) {
        }
    },

    async updateBalanceInDatabase(holderAddress, newBalance) {
        // Replace this with actual data updating logic for your system
        try {
            await database.updateBalance(holderAddress, newBalance);
        } catch (error) {
            console.error('Error updating balance for address:', holderAddress, error);
            throw error;
        }
    },

    async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress);
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error);
            throw error;
        }
    },


    // Implement or reference these helper methods as per your system's logic
    calculateTotalMargin(positions) {
        let totalMargin = 0;
        positions.forEach(position => {
            totalMargin += position.margin;  // Assuming each position object has a 'margin' property
        });
        return totalMargin;
    },

    isMarginConsistent(totalMargin) {
        const expectedMargin = this.getExpectedTotalMargin(); // Implement this method based on your system
        // You can also implement a range-based check instead of an exact value match
        return totalMargin === expectedMargin;
    },

    async saveAuditIndex(blockHeight) {
        const auditData = this.prepareAuditData(); // Implement this method to prepare data for saving
        try {
            await database.saveAuditData(blockHeight, auditData);
        } catch (error) {
            console.error('Error saving audit index for block height:', blockHeight, error);
            throw error;
        }
    },

    prepareAuditData(blockHeight, positions, balanceChanges) {
        // The data structure to hold the audit data
        let auditData = {};

        balanceUpdates.forEach(update => {
            // Assuming each update has contractId, blockHeight, and other relevant info
            const key = `contract-${update.contractId}-block-${update.blockHeight}`;

            // Initialize sub-object if not already present
            if (!auditData[key]) {
                auditData[key] = [];
            }

            // Add the update to the appropriate key
            auditData[key].push({
                holderAddress: update.holderAddress,
                newBalance: update.newBalance,
                // Include any other relevant fields from the update
            });
        });
        // Reset the balanceChanges array after the audit process
        this.balanceChanges = [];

        return JSON.stringify(auditData);
    },




    async lossSocialization(contractId, collateral, fullAmount) {
        let count = 0;
        let zeroPositionAddresses = [];

        // Fetch register data
        let registerData = await this.fetchRegisterData();

        // Count non-zero positions and identify zero position addresses
        registerData.forEach(entry => {
            let position = entry.getRecord(contractId, 'CONTRACT_POSITION');
            if (position === 0) {
                zeroPositionAddresses.push(entry.address);
            } else {
                count++;
            }
        });

        if (count === 0) return;

        let fraction = fullAmount / count;

        // Socialize loss among non-zero positions
        registerData.forEach(entry => {
            if (!zeroPositionAddresses.includes(entry.address)) {
                let available = await this.getMPbalance(entry.address, collateral, 'BALANCE');
                let amount = (available >= fraction) ? fraction : available;

                if (amount > 0) {
                    await this.updateBalance(entry.address, collateral, amount, 'BALANCE');
                }
            }
        });
    },

    async getTotalLoss(contractId, notionalSize) {
        let vwap = 0;
        let volume = 0;
        let bankruptcyVWAP = 0;
        let oracleTwap = 0;

        // Determine if the contract is oracle-based or native
        let contractType = await this.getContractType(contractId);

        if (contractType === 'oracle') {
            // Fetch the liquidation volume data for oracle-based contracts
            let liquidationData = await this.fetchLiquidationVolume(contractId);
            if (!liquidationData) {
                console.log('No liquidation volume data found for oracle-based contract.');
                return 0;
            }
            ({ volume, vwap, bankruptcyVWAP } = liquidationData);

            // Fetch TWAP data from oracle
            oracleTwap = await this.getOracleTwap(contractId, 1);
            let oracleLag = await this.getOracleTwap(contractId, 3);

            if (oracleLag * 0.965 >= oracleTwap) {
                oracleTwap = oracleLag * 0.965;
            }
        } else if (contractType === 'native') {
            // Fetch VWAP data for native contracts
            let vwapData = await this.getNativeVWAP(contractId);
            if (!vwapData) {
                console.log('No VWAP data found for native contract.');
                return 0;
            }
            ({ volume, vwap, bankruptcyVWAP } = vwapData);
            oracleTwap = vwap; // For native contracts, use VWAP as the mark price
        } else {
            console.log('Unknown contract type.');
            return 0;
        }

        // Calculate total loss
        return ((bankruptcyVWAP * notionalSize) / this.COIN) * ((volume * vwap * oracleTwap) / (this.COIN * this.COIN));
    }

    // Additional helper methods or logic as required
}

module.exports = Clearing;