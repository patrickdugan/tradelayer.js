const TallyMap = require('./tally.js')
const ContractList = require('./contractRegistry.js');
const db = require('./db.js')
const BigNumber = require('bignumber.js');
// Access the database where oracle data is stored
const oracleDataDB = db.getDatabase('oracleData');
const MarginMap = require('./marginMap.js')
const Insurance = require('./insurance.js')
const Orderbooks = require('./orderbook.js')
//const VolumeIndex = require('./volumeIndex.js')


class Clearing {
    // ... other methods ...
    constructor() {
        // Access the singleton instance of TallyMap
        //this.tallyMap = TallyMap.getSingletonInstance();
        this.balanceChanges = []; // Initialize an array to track balance changes

    }

    static async clearingFunction(blockHeight) {
        //console.log(`Starting clearing operations for block ${blockHeight}`);

        // 1. Fee Cache Buy
        //await this.feeCacheBuy();

        // 2. Update last exchange block in channels
        //await this.updateLastExchangeBlock(blockHeight);

        // 3. Calculate and update UPNL (Unrealized Profit and Loss)
        //await this.calculateAndUpdateUPNL(blockHeight);

        //await this.processLiquidationsAndMarginAdjustments(blockHeight)

        // 4. Create channels for new trades
        //await this.createChannelsForNewTrades(blockHeight);

        // 5. Set channels as closed if needed
        //await this.closeChannelsIfNeeded();

        // 6. Settle trades at block level
        await this.makeSettlement(blockHeight);

        //console.log(`Clearing operations completed for block ${blockHeight}`);
    }

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
    }

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
    }


    async calculateAndUpdateUPNL(blockHeight) {
        console.log('Calculating and updating UPNL for all contracts at block:', blockHeight);
        
        const contracts = await getAllContracts(); // Fetch all contracts
        for (const contract of contracts) {
            const marginMap = await MarginMap.loadMarginMap(contract.seriesId, blockHeight);
            const marketPrice = await marginMap.getMarketPrice(contract);

            marginMap.clear(marketPrice, contract.seriesId); // Update UPnL for each position in the margin map

            await marginMap.saveMarginMap(blockHeight); // Save the updated margin map
        }
    }

    async processLiquidationsAndMarginAdjustments(blockHeight) {
        console.log(`Processing liquidations and margin adjustments for block ${blockHeight}`);

        const contracts = await getAllContracts(); // Fetch all contracts
        for (const contract of contracts) {
            const marginMap = await MarginMap.loadMarginMap(contract.seriesId, blockHeight);
            
            // Check for and process liquidations
            if (marginMap.needsLiquidation(contract)) {
                const liquidationOrders = await MarginMap.triggerLiquidations(contract);
                // Process liquidation orders as needed
            }

            // Adjust margins based on the updated UPnL
            const positions = await fetchPositionsForAdjustment(contract.seriesId, blockHeight);
            for (const position of positions) {
                const pnlChange = marginMap.calculatePnLChange(position, blockHeight);
                if (pnlChange !== 0) {
                    await adjustBalance(position.holderAddress, pnlChange);
                }
            }

            await marginMap.saveMarginMap(blockHeight);
        }
    }

    static async fetchLiquidationVolume(contractId, blockHeight) {
        // Assuming you have a database method to fetch liquidation data
        try {
            const liquidationData = await db.getDatabase('clearing').findOneAsync({ _id: `liquidation-${contractId}-${blockHeight}` });
            return liquidationData ? liquidationData.volume : null; // Assuming 'volume' is the field you're interested in
        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log(`No liquidation data found for contract ID ${contractId} at block ${blockHeight}`);
                return null; // Handle case where data is not found
            }
            throw error; // Rethrow other types of errors
        }
    }



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
            const results = await db.getDatabase('clearing').findAsync(query);
            results.forEach(doc => {
                clearingDeltas.push(doc.value); // Assuming each document has a 'value' field with the delta data
            });

            return clearingDeltas;
        } catch (error) {
            console.error('Error loading clearing deltas:', error);
            throw error;
        }
    }

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
    }

    static async isPriceUpdatedForBlockHeight(contractId, blockHeight) {
        // Determine if the contract is an oracle contract

        const isOracle = await ContractList.isOracleContract(contractId);
        let latestData;
        //console.log('checking if contract is oracle '+contractId +' '+isOracle)
        if (isOracle) {
            let oracleId = await ContractList.getOracleId(contractId)
            // Query the database for the latest oracle data for the given contract
            //console.log('oracle id '+oracleId)         
            const latestData = await oracleDataDB.findAsync({ oracleId: oracleId });
            //console.log('is price updated ' +JSON.stringify(latestData))
            if (latestData.length>0) {
                const sortedData = [latestData].sort((a, b) => b.blockHeight - a.blockHeight);
                const latestBlockData = sortedData[sortedData.length-1];
                const lastPriceEntry = latestBlockData[latestBlockData.length-1]
                //console.log('checking data '+sortedData+ ' ok now latest Block data '+latestBlockData+' last price entry '+lastPriceEntry)
                // Now, latestBlockData contains the document with the highest blockHeight
                if(blockHeight >=3107880&&blockHeight<=3107903){
                    console.log('Latest price entry:'+ JSON.stringify(lastPriceEntry)+' '+blockHeight);
                }
                if(lastPriceEntry.blockHeight==blockHeight){
                    console.log('latest data '+lastPriceEntry.blockHeight + ' blockHeight '+blockHeight + ' latestData exists and its block = current block ' +Boolean(lastPriceEntry && lastPriceEntry.blockHeight == blockHeight) )
                    return true
                }
            } else {
                //console.error('No data found for contractId:', contractId);
            }
        } /*else {
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
        }*/
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
                let collateralId = await ContractList.getCollateralId(contract.id)
                let inverse = await ContractList.isInverse(contract.id)
                const notionalValue = await ContractList.getNotionalValue(contract.id)
                
                // Update margin maps based on mark prices and current contract positions
                let positions = await Clearing.updateMarginMaps(blockHeight, contract.id, collateralId, inverse,notionalValue); //problem child

                 // Perform additional tasks like loss socialization if needed
                await Clearing.performAdditionalSettlementTasks(blockHeight,positions,contract.id);

                return this.balanceChanges;
            } else {
                // Skip processing for this contract
                //console.log(`No updated price for contract ${contract.id} at block height ${blockHeight}`);
                continue;
            }
        }
    }

    
    static async updateMarginMaps(blockHeight, contractId, collateralId, inverse, notionalValue) {
        let liquidationData = [];
        // Load margin map for the specific contract series
            let marginMap = await MarginMap.getInstance(contractId);
             // Fetch positions that need adjustment
                let positions = await marginMap.getAllPositions();
                //console.log('positions in clearing' +JSON.stringify(positions))
                // Iterate through each position to adjust for profit or loss
                let blob = await Clearing.getPriceChange(blockHeight, contractId)
                console.log(blob.lastPrice, blob.thisPrice)
        for (let position of positions) {
            if(blob.lastPrice==null){
                    blob.lastPrice= position.avgPrice
                }
            // Update margin based on PnL change
            let pnlChange = await Clearing.calculatePnLChange(position, blob.thisPrice, blob.lastPrice, inverse,notionalValue);
            console.log('updatingMarginMaps with pnlChange '+JSON.stringify(position) + ' '+ pnlChange)
            const newPosition = await marginMap.clear(position, position.address, pnlChange, position.avgPrice,contractId)
            console.log('new Position '+ JSON.stringify(newPosition))
            let balance = await TallyMap.hasSufficientBalance(position.address, collateralId, pnlChange)
                // Move funds from available to margin in TallyMap
                if(balance.hasSufficient==true){
                        await TallyMap.updateBalance(position.address, collateralId, pnlChange, 0, 0,0,'clearing');
                }else{
                    console.log('fully utilized available margin for '+JSON.stringify(newPosition))
                    if (await marginMap.checkMarginMaintainance(position.address,contractId)){
                         let liq = await marginMap.triggerLiquidations(newPosition);
                         if(liq!="err:0 contracts"){
                              const orderbook = Orderbooks.getOrderbookInstance(contractId)
                             orderbook.addContractOrder(contractId, liq.price,liq.size,liq.side, false,blockHeight,'liq',position.address,true)
                            liquidationData.push(...liq);
                         }else{
                            throw new Error(console.log(liq))
                         }
                       
                    } 
                }
        }

            // Save the updated margin map
        await marginMap.saveMarginMap(false);
        console.log('any liquidations '+liquidationData)
        return positions;
    }

    static async getPriceChange(blockHeight, contractId){
        let isOracleContract = await ContractList.isOracleContract(contractId)
        let oracleId = null
        let propertyId1 = null
        let propertyId2 = null
        let latestData
        if(isOracleContract){
            oracleId = await ContractList.getOracleId(contractId)
            latestData = await oracleDataDB.findAsync({ oracleId: oracleId });
           
        }else{
            let info = await ContractList.getContractInfo(contractId)
            propertyId1 = info.native.native.onChainData[0]
            propertyId2 = info.native.native.onChainData[1]
            latestData = await volumeIndexDB.findOneAsync({propertyId1:propertyId1,propertyId2:propertyId2})
        }
            //console.log('is price updated ' +JSON.stringify(latestData))
                const sortedData = [latestData].sort((a, b) => b.blockHeight - a.blockHeight);
                const latestBlockData = sortedData[sortedData.length-1];
                const lastPriceEntry = latestBlockData[latestBlockData.length-1]
                const currentMarkPrice = lastPriceEntry.data.price;
            
                let previousMarkPrice = null
                
                if(sortedData.length>1){
                    previousMarkPrice = latestBlockData[latestBlockData.length-2].data.price
                }
                    console.log('checking mark price current and last '+currentMarkPrice+' '+previousMarkPrice)
                return {lastprice: previousMarkPrice, thisPrice:currentMarkPrice}
    }

    static async calculatePnLChange(position, currentMarkPrice, previousMarkPrice, inverse,notionalValue){
      

        // Calculate P&L change for the position based on the number of contracts
        // Assuming a long position benefits from a price increase and vice versa
        let pnl 

        const priceBN = new BigNumber(currentMarkPrice);
        const avgPriceBN = new BigNumber(previousMarkPrice);
        const contractsBN = new BigNumber(position.contracts);
        const notionalValueBN = new BigNumber(notionalValue);

        if (inverse) {
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
            pnl = priceBN
                .minus(1)
                .dividedBy(avgPriceBN.minus(1))
                .times(contractsBN)
                .times(notionalValueBN);

            //console.log('pnl ' + pnl.toNumber());
        } else {
            // For linear contracts: PnL = (exitPrice - entryPrice) * contracts * notional
            pnl = priceBN
                .minus(avgPriceBN)
                .times(contractsBN)
                .times(notionalValueBN);

            //console.log('pnl ' + pnl.toNumber());
        }

        console.log(priceBN +' '+currentMarkPrice+' '+avgPriceBN+' ' +previousMarkPrice+' '+contractsBN+' '+position.contracts+' '+notionalValueBN+' '+notionalValue)
        // Adjust sign based on whether the position is long or short
        pnl = position.contracts>0 ? pnl : pnl.negated();

        return pnl.toNumber();
    }

    async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress);
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error);
            throw error;
        }
    }

    static async performAdditionalSettlementTasks(blockHeight,positions, contractId) {
 
        try {
            // Step 1: Calculate total losses
            const totalLoss = Clearing.getTotalLoss(positions,contractId);

            // Step 2: Check if insurance fund payout is needed
            if (totalLoss > 0) {
                // Step 3: Apply insurance fund payout
                const insurance = await Insurance.getFund(contractId)
                const payout = insurance.applyPayout(totalLoss);

                // Step 4: Socialize remaining loss if any
                const remainingLoss = totalLoss - payout;
                if (remainingLoss > 0) {
                    await Clearing.socializeLoss(remainingLoss, positions);
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

                 // Check for the consistency of balance updates
            let balanceUpdates = this.fetchBalanceUpdatesForSettlement();
                if (!this.areBalanceUpdatesConsistent(balanceUpdates)) {
                    throw new Error("Inconsistent balance updates detected");
                }

                    // Save audit data
                    const auditData = this.prepareAuditData(); 
                    await this.saveAuditData(blockHeight, auditData);
        }
    }

    async saveClearingSettlementEvent(contractId, settlementDetails, blockHeight) {
        const clearingDB = dbInstance.getDatabase('clearing');
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
            );
            console.log(`Clearing settlement event record saved successfully: ${recordKey}`);
        } catch (error) {
            console.error(`Error saving clearing settlement event record: ${recordKey}`, error);
            throw error;
        }
    }

    async loadClearingSettlementEvents(contractId, startBlockHeight = 0, endBlockHeight = Number.MAX_SAFE_INTEGER) {
        const clearingDB = dbInstance.getDatabase('clearing');
        try {
            const query = {
                contractId: contractId,
                blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
            };
            const clearingRecords = await clearingDB.findAsync(query);
            return clearingRecords.map(record => ({
                blockHeight: record.blockHeight,
                settlementDetails: record.settlementDetails
            }));
        } catch (error) {
            console.error(`Error loading clearing settlement events for contractId ${contractId}:`, error);
            throw error;
        }
    }


    async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress);
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error);
            throw error;
        }
    }


    // Implement or reference these helper methods as per your system's logic
    calculateTotalMargin(positions) {
        let totalMargin = 0;
        positions.forEach(position => {
            totalMargin += position.margin;  // Assuming each position object has a 'margin' property
        });
        return totalMargin;
    }

    isMarginConsistent(totalMargin) {
        const expectedMargin = this.getExpectedTotalMargin(); // Implement this method based on your system
        // You can also implement a range-based check instead of an exact value match
        return totalMargin === expectedMargin;
    }

    async saveAuditIndex(blockHeight) {
        const auditData = this.prepareAuditData(); // Implement this method to prepare data for saving
        try {
            await database.saveAuditData(blockHeight, auditData);
        } catch (error) {
            console.error('Error saving audit index for block height:', blockHeight, error);
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
            });
        });
        // Reset the balanceChanges array after the audit process
        this.balanceChanges = [];

        return JSON.stringify(auditData);
    }

    static async getTotalLoss(positions, contractId) {
            let vwap = 0;
            let volume = 0;
            let bankruptcyVWAP = 0;
            let oracleTwap = 0;

            let isOracleContract = await ContractList.isOracleContract(contractId);
            let notionalSize = await ContractList.getNotionalValue(contractId)

            if (isOracleContract) {
                let liquidationData = await ContractList.fetchLiquidationVolume(positions, contractId);
                if (!liquidationData) {
                    console.log('No liquidation volume data found for oracle-based contract.');
                    return 0;
                }
                ({ volume, vwap, bankruptcyVWAP } = liquidationData);

                // Fetch TWAP data from oracle
                oracleTwap = await Oracles.getTwap(contractId); // Assuming Oracles module provides TWAP data
            } /*else{
                // Fetch VWAP data for native contracts
                let vwapData = VolumeIndex.getVwapData(contractId); // Assuming VolumeIndex module provides VWAP data
                if (!vwapData) {
                    console.log('No VWAP data found for native contract.');
                    return 0;
                }
                ({ volume, vwap, bankruptcyVWAP } = vwapData);
                oracleTwap = vwap;
            }*/

            return ((bankruptcyVWAP * notionalSize) * (volume * vwap * oracleTwap));
    }

    static async socializeLoss(contractId, totalLoss, positions, lastPrice) {
        try {
            // Get all open positions for the given contract
            const openPositions = await this.getAllPositions();

            // Calculate the volume weighted price for every open position
            const vwaps = await Promise.all(openPositions.map(async (position) => {
                // Get the market price for the contract (assuming you have a method to retrieve it)
                const marketPrice = await this.getMarketPrice(contractId);

                // Calculate the volume weighted price for the position
                const vwap = (position.avgPrice * position.contracts + lastPrice * position.unrealizedPNL) / (position.contracts + position.unrealizedPNL);

                return vwap;
            }));

            // Calculate the total volume weighted price and total open position uPNL
            const totalVWAP = vwaps.reduce((sum, vwap) => sum.plus(vwap), new BigNumber(0));
            const totalOpenUPNL = openPositions.reduce((sum, position) => sum.plus(position.unrealizedPNL), new BigNumber(0));

            // Calculate the percentage of total loss compared to total PNL
            const lossPercentage = totalLoss.dividedBy(totalOpenUPNL);

            // Reduce positive uPNL for all open positions by the calculated percentage
            const updatedPositions = openPositions.map((position, index) => {
                const vwap = new BigNumber(vwaps[index]);
                const adjustedUPNL = vwap.times(lossPercentage).times(position.contracts);

                // Ensure the adjusted uPNL doesn't exceed the total open position uPNL
                const newUPNL = BigNumber.minimum(adjustedUPNL, position.unrealizedPNL);

                // Update the position with the adjusted uPNL
                return {
                    ...position,
                    unrealizedPNL: newUPNL.toNumber(),
                };
            });

            // Update the positions in the margin map
            for (const updatedPosition of updatedPositions) {
                this.margins.set(updatedPosition.address, updatedPosition);
                await this.recordMarginMapDelta(updatedPosition.address, contractId, 0, 0, 0, -updatedPosition.unrealizedPNL, 0, 'socializeLoss');
            }

            // Save the updated margin map
            await this.saveMarginMap(true);

            console.log('Socialized loss successfully.');

        } catch (error) {
            console.error('Error socializing loss:', error);
            throw error;
        }
    }


    async fetchAuditData(auditDataKey) {
        // Implement logic to fetch audit data from the database
        try {
            const auditData = await database.getAuditData(auditDataKey);
            return auditData;
        } catch (error) {
            console.error('Error fetching audit data:', error);
            throw error;
        }
    }

    // Additional helper methods or logic as required
}

module.exports = Clearing;