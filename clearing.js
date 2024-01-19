const { tallyMap } = require('./tally.js')
const { contractRegistry } = require('./contractRegistry.js')
const { volumeIndex } = require('./volumeIndex.js')

class Clearing {
    constructor() {
        this.balanceChanges = []; // Initialize an array to track balance changes
    }

    async clearingFunction(blockHeight) {
        console.log(`Starting clearing operations for block ${blockHeight}`)

        // 1. Fee Cache Buy
        //await this.feeCacheBuy()

        // 2. Update last exchange block in channels
        //await this.updateLastExchangeBlock(blockHeight)

        // 3. Calculate and update UPNL (Unrealized Profit and Loss)
        //await this.calculateAndUpdateUPNL(blockHeight)

        //await this.processLiquidationsAndMarginAdjustments(blockHeight)

        // 4. Create channels for new trades
        //await this.createChannelsForNewTrades(blockHeight)

        // 5. Set channels as closed if needed
        //await this.closeChannelsIfNeeded()

        // 6. Settle trades at block level
        await this.makeSettlement(blockHeight)

        console.log(`Clearing operations completed for block ${blockHeight}`)
    }

    async feeCacheBuy() {
        console.log('Processing fee cache buy')

        // Fetch fees from your data source (e.g., database or in-memory store)
        let fees = await this.fetchFees()

        // Process each fee category
        fees.forEach(fee => {
            // Implement logic to use these fees
            // For example, converting fees to another form, distributing them, etc.
        })

        // Save any changes back to your data source
        await this.saveFees(fees)
    }

    async updateLastExchangeBlock(blockHeight) {
        console.log('Updating last exchange block in channels')

        // Fetch the list of active channels
        let channels = await this.getActiveChannels()

        // Update the last active block for each channel
        channels.forEach(channel => {
            if (channel.isActive) {
                channel.lastExchangeBlock = blockHeight;
            }
        })

        // Save the updated channel information
        await this.saveChannels(channels)
    }


    async calculateAndUpdateUPNL(blockHeight) {
        console.log('Calculating and updating UPNL for all contracts at block:', blockHeight)

        const contracts = await getAllContracts() // Fetch all contracts
        for (const contract of contracts) {
            const marginMap = await MarginMap.loadMarginMap(contract.seriesId, blockHeight)
            const marketPrice = await marginMap.getMarketPrice(contract)

            marginMap.clear(marketPrice, contract.seriesId) // Update UPnL for each position in the margin map

            await marginMap.save(blockHeight) // Save the updated margin map
        }
    }

    async processLiquidationsAndMarginAdjustments(blockHeight) {
        console.log(`Processing liquidations and margin adjustments for block ${blockHeight}`)

        const contracts = await getAllContracts() // Fetch all contracts
        for (const contract of contracts) {
            const marginMap = await MarginMap.loadMarginMap(contract.seriesId, blockHeight)

            // Check for and process liquidations
            if (marginMap.needsLiquidation(contract)) {
                // TODO: factor out of MarginMap
                //const liquidationOrders = await MarginMap.triggerLiquidations(contract)
                // Process liquidation orders as needed
            }

            // Adjust margins based on the updated UPnL
            const positions = await fetchPositionsForAdjustment(contract.seriesId, blockHeight)
            for (const position of positions) {
                const pnlChange = marginMap.calculatePnLChange(position, blockHeight)
                if (pnlChange !== 0) {
                    await adjustBalance(position.holderAddress, pnlChange)
                }
            }

            await marginMap.save(blockHeight)
        }
    }

    static async fetchLiquidationVolume(contractId, blockHeight) {
        // Assuming you have a database method to fetch liquidation data
        try {
            const liquidationData = await db.getDatabase('clearing').findOneAsync({ _id: `liquidation-${contractId}-${blockHeight}` })
            return liquidationData ? liquidationData.volume : null; // Assuming 'volume' is the field you're interested in
        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log(`No liquidation data found for contract ID ${contractId} at block ${blockHeight}`)
                return null; // Handle case where data is not found
            }
            throw error; // Rethrow other types of errors
        }
    }



    async createChannelsForNewTrades(blockHeight) {
        //console.log('Creating channels for new trades')

        // Fetch new trades from the block
        let newTrades = await this.fetchNewTrades(blockHeight)

        // Create channels for each new trade
        newTrades.forEach(trade => {
            let channel = this.createChannelForTrade(trade)
            // Save the new channel
            this.saveChannel(channel)
        })
    }

    /**
 * Loads clearing deltas from the clearing database for a given block height.
 * @param {number} blockHeight - The block height for which to load clearing deltas.
 * @returns {Promise<Array>} - A promise that resolves to an array of clearing deltas for the block.
 */
    async loadClearingDeltasForBlock(blockHeight) {
        try {
            const clearingDeltas = [];
            const query = { blockHeight: blockHeight }; // Query to match the block height

            // Fetch the deltas from the database
            const results = await db.getDatabase('clearing').findAsync(query)
            results.forEach(doc => {
                clearingDeltas.push(doc.value) // Assuming each document has a 'value' field with the delta data
            })

            return clearingDeltas;
        } catch (error) {
            console.error('Error loading clearing deltas:', error)
            throw error;
        }
    }

    async closeChannelsIfNeeded() {
        console.log('Closing channels if needed')

        // Fetch all active channels
        let channels = await this.getActiveChannels()

        // Check each channel for closing conditions
        channels.forEach(channel => {
            if (this.shouldCloseChannel(channel)) {
                channel.close()
                // Perform any additional clean-up or notifications required
            }
        })

        // Save the updated state of channels
        await this.saveChannels(channels)
    }

    
    static async isPriceUpdatedForBlockHeight(contractId, blockHeight) {
        // Determine if the contract is an oracle contract

        const isOracle = await ContractList.isOracleContract(contractId);
        let latestData;

        if (isOracle!=false) {
            // Access the database where oracle data is stored
            const oracleDataDB = db.getDatabase('oracleData');
            // Query the database for the latest oracle data for the given contract
                       
            const latestData = await oracleDataDB.findOneAsync({ oracleId: isOracle });
            if (latestData) {
                const sortedData = [latestData].sort((a, b) => b.blockHeight - a.blockHeight);
                const latestBlockData = sortedData[0];
                // Now, latestBlockData contains the document with the highest blockHeight
                //console.log('Latest Block Data:', latestBlockData);
                if(latestData.blockHeight==blockHeight){
                    //console.log('latest data '+latestData.blockHeight + ' blockHeight '+blockHeight + ' latestData exists and its block = current block ' +Boolean(latestData && latestData.blockHeight == blockHeight) )
                    return true
                }
            } else {
                //console.error('No data found for contractId:', contractId);
            }
        } else {
            // Access the database where volume index data is stored
            const volumeIndexDB = db.getDatabase('volumeIndex');
                        // Query the database for the latest volume index data for the given contract
            const latestData = await volumeIndexDB.findOneAsync({ contractId: contractId });
            if (latestData) {
                const sortedData = [latestData].sort((a, b) => b.blockHeight - a.blockHeight);
                const latestBlockData = sortedData[0];
                // Now, latestBlockData contains the document with the highest blockHeight
                if(latestData.blockHeight==blockHeight){

                console.log('Latest Block Data:', latestBlockData);
                    //console.log('latest data '+latestData.blockHeight + ' blockHeight '+blockHeight + ' latestData exists and its block = current block ' +Boolean(latestData && latestData.blockHeight == blockHeight) )
                    return true
                }
            } else {
                //console.error('No data found for contractId:', contractId);
            }
        }
        //console.log('no new data')
        return false; // No updated data for this block height
    }

    static async makeSettlement(blockHeight) {
              const contracts = await ContractList.getAllContracts();
        for (const contract of contracts) {
            // Check if there is updated price information for the contract
            if (await Clearing.isPriceUpdatedForBlockHeight(contract.id, blockHeight)) {
                console.log('new price')
                // Proceed with processing for this contract
                console.log('Making settlement for positions at block height:', JSON.stringify(contract) + ' ' + blockHeight);
                let collateralId = ContractList.getCollateralId(contract.id)
                let inverse = ContractList.isInverse(contract.id)
            // Fetch positions that need adjustment
                let positions = await Clearing.fetchPositionsForAdjustment(contract.id, blockHeight);
                // Iterate through each position to adjust for profit or loss
    
                // Update margin maps based on mark prices and current contract positions
                await Clearing.updateMarginMaps(blockHeight, positions, blockHeight, contract.id, collateralId); //problem child

                // Adjust the balance based on the P&L change
                await Clearing.adjustBalance(position.holderAddress, pnlChange, collateralId);

                // Perform additional tasks like loss socialization if needed
                await Clearing.performAdditionalSettlementTasks(blockHeight, positions);

                // Save the updated position information
                await Clearing.savePositions(positions);
                return [positions, this.balanceChanges];
            } else {
                // Skip processing for this contract
                //console.log(`No updated price for contract ${contract.id} at block height ${blockHeight}`);
                continue;
            }
        }
    }

    
    static async updateMarginMaps(blockHeight, positions, block, contractId, collateralId, inverse) {
        let liquidationData = [];
        console.log('positions in updateMarginMaps '+JSON.stringify(positions))
        for (let position of positions) {
            // Load margin map for the specific contract series
            let marginMap = await MarginMap.getInstance(position.contractSeriesId);

            // Update margin based on PnL change
            let pnlChange = await Clearing.calculatePnLChange(position, blockHeight);
            console.log('updatingMarginMaps '+marginMap + ' '+ pnlChange)
            const newPosition = marginMap.clearMargin(contractId, position.holderAddress, pnlChange, inverse);
            console.log('new Position '+ JSON.stringify(newPosition))
            // Check if maintenance margin is breached
            if (marginMap.checkMarginMaintainence(position.holderAddress,contractId)) {
                // Move funds from available to margin in TallyMap
                if(TallyMap.hasSufficientBalance(position.holderAddress, propertyId, requiredAmount)){
                        await tallyMap.updateBalance(position.holderAddress, -pnlChange, 0, +pnlChange,0);
                }else{
                    console.log('insufficient maint. margin for '+JSON.stringify(newPosition))
                    let liquidationOrders = await marginMap.triggerLiquidations(newPosition);
                    liquidationData.push(...liquidationOrders);
                }
            }
        }

            // Save the updated margin map
        await marginMap.save(blockHeight);
        console.log('any liquidations '+liquidationData)
        return liquidationData;
    }
    
    static async getCurrentMarkPrice(blockHeight, oracleId, propertyId1, propertyId2) {
        // Find the highest block height that is less than or equal to the target block height
        const oracleDataDB = db.getDatabase('oracleData');
        let entries

          try {
                let query;

                if (oracleId) {
                    query = { oracleId: oracleId };
                } else if (propertyId1 && propertyId2) {
                    query = { 'propertyId1-propertyId2': `${propertyId1}-${propertyId2}` };
                } else {
                    // No valid parameters provided
                    return null;
                }

                // Query the database for the latest oracle data based on the specified parameters
                const entries = await oracleDataDB.findOneAsync(query);

            } catch (error) {
                console.error('Error fetching data from Oracle DB:', error);
                throw error;
            }

            let closestLowerBlockHeight = null;
            for (const entry of entries) {
                if (entry.blockHeight <= blockHeight) {
                    closestLowerBlockHeight = entry.blockHeight;
                    break;
                }
            }

            // If a closest lower block height is found, retrieve the corresponding data
            if (closestLowerBlockHeight !== null) {
                const result = await oracleDataDB.findOne({ blockHeight: closestLowerBlockHeight });
                return result;
            } else {
                // No data found for the target block height or lower
                return null;
            }
    }


    static async getPreviousMarkPrice(blockHeight, oracleId, propertyId1, propertyId2) {
        // Logic to fetch the market price for a contract at the previous block height
        // Example: return await marketPriceDB.findOne({blockHeight: blockHeight - 1});
        const oracleDataDB = db.getDatabase('oracleData');

         try {
                let query;

                if (oracleId) {
                    query = { oracleId: oracleId };
                } else if (propertyId1 && propertyId2) {
                    query = { 'propertyId1-propertyId2': `${propertyId1}-${propertyId2}` };
                } else {
                    // No valid parameters provided
                    return null;
                }

                // Find the 2nd highest block height that is less than the current block height
                const indexArray = await oracleDataDB.findOneAsync({
                    $and: [
                        { blockHeight: { $lt: blockHeight } },
                        query
                    ]
                }).sort({ blockHeight: -1 });

            } catch (error) {
                console.error('Error fetching data from Oracle DB:', error);
                throw error;
            }

        let secondHighestBlockHeight = null;
        let count = 0;
        for (const entry of indexArray) {
            if (entry.blockHeight < blockHeight) {
                if (count === 1) {
                    secondHighestBlockHeight = entry.blockHeight;
                    break;
                }
                count++;
            }
        }

        // If a 2nd highest block height is found, retrieve the corresponding data
        if (secondHighestBlockHeight !== null) {
            const result = await oracleDataDB.findOneAsync({ blockHeight: secondHighestBlockHeight });
            return result;
        } else {
            // No data found for the 2nd latest block
            return null;
        }
    }

    // Additional functions to be implemented
    async fetchPositionsForAdjustment(blockHeight) {
        try {
            let marginMap = await MarginMap.loadMarginMap(this.seriesId, blockHeight)

            let positions = Array.from(marginMap.margins.entries()).map(([address, positionData]) => ({
                address,
                contracts: positionData.contracts, // Ensure this reflects the actual structure of positionData
                ...positionData
            }))

            return positions;
        } catch (error) {
            console.error('Error fetching positions for adjustment:', error)
            throw error;
        }
    }

    calculatePnLChange(position, blockHeight) {
        // Retrieve the current and previous mark prices for the block height
        let currentMarkPrice = this.getCurrentMarkPrice(blockHeight)
        let previousMarkPrice = this.getPreviousMarkPrice(blockHeight)

        // Calculate the price change per contract
        let priceChangePerContract = currentMarkPrice - previousMarkPrice;

        // Calculate P&L change for the position based on the number of contracts
        // Assuming a long position benefits from a price increase and vice versa
        let pnlChange = position.contracts * priceChangePerContract;

        // Adjust sign based on whether the position is long or short
        pnlChange *= position.isLong ? 1 : -1; // Assuming position.isLong is a boolean indicating position type

        return pnlChange;
    }

    async adjustBalance(holderAddress, pnlChange) {
        try {
            // Assuming you have a defined propertyId for the type of balance being adjusted
            const propertyId = this.getPropertyIdForPnL()

            // Fetch the current balance details
            let balanceDetails = tallyMap.getAddressBalances(holderAddress)

            // Assuming balanceDetails includes the fields 'available' and 'reserved'
            let available = balanceDetails.available || 0;
            let reserved = balanceDetails.reserved || 0;

            // Adjust available balance based on P&L change
            available += pnlChange;

            // Update the balance in TallyMap
            tallyMap.updateBalance(holderAddress, propertyId, available, reserved)
            this.balanceChanges.push({
                blockHeight: this.currentBlockHeight, // Assuming this is set appropriately
                holderAddress: holderAddress,
                pnlChange: pnlChange
            })

            // Optionally, you can save the TallyMap state to the database
            await tallyMap.save(someBlockHeight) // Replace someBlockHeight with the appropriate block height
        } catch (error) {
            console.error('Error adjusting balance for address:', holderAddress, error)
            throw error;
        }
    }

    async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress)
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error)
            throw error;
        }
    }

    async performAdditionalSettlementTasks(blockHeight, positions) {
        try {
            // Step 1: Calculate total losses
            const totalLoss = this.getTotalLoss(positions)

            // Step 2: Check if insurance fund payout is needed
            if (totalLoss > 0) {
                // Step 3: Apply insurance fund payout
                const payout = await this.insuranceFund.applyPayout(totalLoss)

                // Step 4: Socialize remaining loss if any
                const remainingLoss = totalLoss - payout;
                if (remainingLoss > 0) {
                    await this.socializeLoss(remainingLoss, positions)
                }
            }
        } catch (error) {
            console.error('Error performing additional settlement tasks:', error)
            throw error;
        }
    }


    async auditSettlementTasks(blockHeight, positions) {
        try {
            // Check total margin consistency
            let totalMargin = this.calculateTotalMargin(positions)
            if (!this.isMarginConsistent(totalMargin)) {
                throw new Error("Inconsistent total margin detected")
            }

            // Verify insurance fund balance is not negative
            if (this.insuranceFund.getBalance() < 0) {
                throw new Error("Negative balance in the insurance fund")
            }

            // Save index populated during balance adjustment
            await this.saveAuditIndex(blockHeight)
        } catch (error) {
            console.error('Audit error at block height', blockHeight, ':', error)

            // Check for the consistency of balance updates
            let balanceUpdates = this.fetchBalanceUpdatesForSettlement()
            if (!this.areBalanceUpdatesConsistent(balanceUpdates)) {
                throw new Error("Inconsistent balance updates detected")
            }

            // Save audit data
            const auditData = this.prepareAuditData()
            await this.saveAuditData(blockHeight, auditData)
        }
    }

    async saveClearingSettlementEvent(contractId, settlementDetails, blockHeight) {
        const clearingDB = dbInstance.getDatabase('clearing')
        const recordKey = `clearing-${contractId}-${blockHeight}`;

        const clearingRecord = {
            _id: recordKey,
            contractId,
            settlementDetails,
            blockHeight
        };

        try {
            await clearingDB.updateAsync(
                { _id: recordKey },
                clearingRecord,
                { upsert: true }
            )
            console.log(`Clearing settlement event record saved successfully: ${recordKey}`)
        } catch (error) {
            console.error(`Error saving clearing settlement event record: ${recordKey}`, error)
            throw error;
        }
    }

    async loadClearingSettlementEvents(contractId, startBlockHeight = 0, endBlockHeight = Number.MAX_SAFE_INTEGER) {
        const clearingDB = dbInstance.getDatabase('clearing')
        try {
            const query = {
                contractId: contractId,
                blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
            };
            const clearingRecords = await clearingDB.findAsync(query)
            return clearingRecords.map(record => ({
                blockHeight: record.blockHeight,
                settlementDetails: record.settlementDetails
            }))
        } catch (error) {
            console.error(`Error loading clearing settlement events for contractId ${contractId}:`, error)
            throw error;
        }
    }


    async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress)
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error)
            throw error;
        }
    }


    // Implement or reference these helper methods as per your system's logic
    calculateTotalMargin(positions) {
        let totalMargin = 0;
        positions.forEach(position => {
            totalMargin += position.margin;  // Assuming each position object has a 'margin' property
        })
        return totalMargin;
    }

    isMarginConsistent(totalMargin) {
        const expectedMargin = this.getExpectedTotalMargin() // Implement this method based on your system
        // You can also implement a range-based check instead of an exact value match
        return totalMargin === expectedMargin;
    }

    async saveAuditIndex(blockHeight) {
        const auditData = this.prepareAuditData() // Implement this method to prepare data for saving
        try {
            await database.saveAuditData(blockHeight, auditData)
        } catch (error) {
            console.error('Error saving audit index for block height:', blockHeight, error)
            throw error;
        }
    }

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
            })
        })
        // Reset the balanceChanges array after the audit process
        this.balanceChanges = [];

        return JSON.stringify(auditData)
    }

    async lossSocialization(contractId, collateral, fullAmount) {
        let count = 0;
        let zeroPositionAddresses = [];

        // Fetch register data
        let registerData = await this.fetchRegisterData()

        // Count non-zero positions and identify zero position addresses
        registerData.forEach(entry => {
            let position = entry.getRecord(contractId, 'CONTRACT_POSITION')
            if (position === 0) {
                zeroPositionAddresses.push(entry.address)
            } else {
                count++;
            }
        })

        if (count === 0) return;

        let fraction = fullAmount / count;

        // Socialize loss among non-zero positions
        for (const entry of registerData) {
            if (!zeroPositionAddresses.includes(entry.address)) {
                let balanceDetails = tallyMap.getAddressBalances(entry.address)
                let available = balanceDetails.find(b => b.propertyId === collateral)?.available || 0;
                let amount = Math.min(available, fraction)

                if (amount > 0) {
                    tallyMap.updateBalance(entry.address, collateral, -amount, -amount, 0) // Assuming updateBalance deducts from available
                }
            }
        }

        // Optionally, save the TallyMap state to the database
        await tallyMap.save(blockHeight) // Replace blockHeight with the appropriate value
    }

    async getTotalLoss(contractId, notionalSize) {
        let vwap = 0;
        let volume = 0;
        let bankruptcyVWAP = 0;
        let oracleTwap = 0;

        let contractType = contractRegistry.getContractType(contractId)

        if (contractType === 'oracle') {
            let liquidationData = await contractRegistry.fetchLiquidationVolume(contractId)
            if (!liquidationData) {
                console.log('No liquidation volume data found for oracle-based contract.')
                return 0;
            }
            ({ volume, vwap, bankruptcyVWAP } = liquidationData)

            // Fetch TWAP data from oracle
            oracleTwap = await Oracles.getTwap(contractId) // Assuming Oracles module provides TWAP data
        } else if (contractType === 'native') {
            // Fetch VWAP data for native contracts
            let vwapData = volumeIndex.getVwapData(contractId) // Assuming VolumeIndex module provides VWAP data
            if (!vwapData) {
                console.log('No VWAP data found for native contract.')
                return 0;
            }
            ({ volume, vwap, bankruptcyVWAP } = vwapData)
            oracleTwap = vwap;
        } else {
            console.log('Unknown contract type.')
            return 0;
        }

        return ((bankruptcyVWAP * notionalSize) / this.COIN) * ((volume * vwap * oracleTwap) / (this.COIN * this.COIN))
    }

    async fetchAuditData(auditDataKey) {
        // Implement logic to fetch audit data from the database
        try {
            const auditData = await database.getAuditData(auditDataKey)
            return auditData;
        } catch (error) {
            console.error('Error fetching audit data:', error)
            throw error;
        }
    }

    // Additional helper methods or logic as required
}

module.exports = Clearing;