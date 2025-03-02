const TallyMap = require('./tally.js')
const ContractRegistry = require('./contractRegistry.js');
const db = require('./db.js')
const BigNumber = require('bignumber.js');
// Access the database where oracle data is stored

const MarginMap = require('./marginMap.js')
const Insurance = require('./insurance.js')
const Orderbooks = require('./orderbook.js')
const Channels = require('./channels.js')
const PropertyManager = require('./property.js')
const VolumeIndex = require('./volumeIndex.js')
const Oracles = require('./oracle.js')


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
        await Clearing.feeCacheBuy(blockHeight);

        // 2. Set channels as closed if needed
        await Channels.removeEmptyChannels(blockHeight);

        // 3. Ensure correct margins, init margin and liq prices for new conditions
        //await Clearing.updateAllPositions(blockHeight)
        // 4. Settle trades at block level
        await Clearing.makeSettlement(blockHeight);

        //console.log(`Clearing operations completed for block ${blockHeight}`);
        return
    }

    // Define each of the above methods with corresponding logic based on the C++ functions provided
    // ...static async feeCacheBuy(block) {
static async feeCacheBuy(block) {
    const ContractRegistry = require('./contractRegistry.js');

    // Load fees from database (includes contract IDs now)
    let fees = await TallyMap.loadFeeCacheFromDB();

    if (!fees || fees.size === 0) {
        return;
    }

    for (let [key, feeData] of fees.entries()) {
        //console.log('🔎 Fee cache ' + key +' '+ JSON.stringify(feeData));
        if (!feeData || !feeData.contract || feeData.value <= 0) continue;

        let [property, contractId] = key.split("-");
        let feeAmount = new BigNumber(feeData.value);
        let stash = feeData.stash ||0
        if (feeAmount.isZero()) continue;

        //console.log(`💰 Processing fee: property=${property}, contract=${contractId}, amount=${feeAmount}`);

        let isNativeAsset = property.toString().startsWith("s") || property === "1";

        // Lookup contract details to check if it's oracle-based
        let isOracle = !(await ContractRegistry.isNativeContract(contractId));
        let insurance = await Insurance.getInstance(contractId, isOracle);
        let globalInsurance = await Insurance.getInstance(1, false); // Ensure global insurance for contract 1
        let buyAmount = new BigNumber(0);
        let insuranceAmount = new BigNumber(0);
        let stashAmount = new BigNumber(0);

        if (isOracle) {
            // Oracle-based contracts: 50% to contract's insurance fund, 50% to insurance fund 1
            insuranceAmount = feeAmount.dividedBy(2).decimalPlaces(8, BigNumber.ROUND_DOWN);
            stashAmount = feeAmount.minus(insuranceAmount).decimalPlaces(8, BigNumber.ROUND_UP); // Ensure remainder goes to stash
            console.log('stash amount '+stashAmount +' '+stashAmount.toNumber())
        } else {
            // Native contracts: 100% goes to buying property 1
            buyAmount = feeAmount;
        }

        //console.log(`🔹 Allocations - Buy: ${buyAmount}, Contract Insurance: ${insuranceAmount}, Global Insurance: ${globalInsuranceAmount}`);

        // **Ensure buy orders are only placed if there's liquidity**
        if (buyAmount.gt(0) || stashAmount.gt(0)) {
            let orderBookKey = `1-${property}`;
            let orderbook = await Orderbooks.getOrderbookInstance(orderBookKey);

            let extractedOrderbook = orderbook.orderBooks[orderBookKey] || { buy: [], sell: [] };

            let orderbookCopy = {
                buy: Array.isArray(extractedOrderbook.buy) ? [...extractedOrderbook.buy] : [],
                sell: Array.isArray(extractedOrderbook.sell) ? [...extractedOrderbook.sell] : []
            };

            // Check if there are any sell orders available before placing a buy order
            if (orderbookCopy.sell.length > 0) {
                const totalBuy = buyAmount.plus(stashAmount);

                const order = {
                    offeredPropertyId: property,
                    desiredPropertyId: 1,
                    amountOffered: totalBuy.toNumber(),
                    amountExpected: 0.00000001,
                    blockTime: block,
                    sender: "feeCache"
                };

                const calculatedPrice = orderbook.calculatePrice(order.amountOffered, order.amountExpected);
                order.price = calculatedPrice;

                let reply = await orderbook.insertOrder(order, orderBookKey, false, false);
                console.log(`📊 Order placed: ${JSON.stringify(reply)}`);

                await TallyMap.updateFeeCache(property, -totalBuy.toNumber(), contractId,true,true);
                const matchResult = await orderbook.matchTokenOrders(reply);
                if (matchResult.matches && matchResult.matches.length > 0) {
                    //console.log(`✅ Fee Match Result: ${JSON.stringify(matchResult)}`);
                    await orderbook.processTokenMatches(matchResult.matches, block, null, false);
                    //console.log(`🌎 Sending ${globalInsuranceAmount} to global insurance fund 1`);
                    const depositAmount = matchResult.matches.reduce((acc, match) => acc.plus(match.amountOfTokenA), new BigNumber(0))
                    await globalInsurance.deposit(1, depositAmount,block);
                    const totalMatchedB = matchResult.matches.reduce((acc, match) => {
                    const amountB = new BigNumber(match.amountOfTokenB || 0); // Fallback to 0 if undefined
                    return acc.plus(amountB);
                }, new BigNumber(0));

                } else {
                    console.log(`⚠️ No matching orders found for ${property}.`);
                }
                await orderbook.saveOrderBook(orderBookKey);
            } else {
                //console.log(`⚠️ No sell liquidity for ${property}, checking stash handling.`);
                let newStash = new BigNumber(stash).plus(stashAmount);
                console.log('🏦 stash '+stash+' '+stashAmount)
                // Prevent dust accumulation by setting a minimum threshold
                if (newStash.isLessThan(1e-8)) {
                    //console.log(`🚨 Preventing dust accumulation: Stash is too small (${newStash}), discarding.`);
                    newStash = new BigNumber(0);
                }

                // Update the fee cache with the adjusted stash
                await TallyMap.updateFeeCache(property, stashAmount.toNumber(), contractId, true);
            }
        }

        // **Ensure contract insurance deposit is stored correctly**
        if (insuranceAmount.gt(0)) {
            console.log(`🏦 Sending ${insuranceAmount} to insurance fund for contract ${contractId}`);
            try {
                await insurance.deposit(property, insuranceAmount.toNumber(),block);
                await TallyMap.updateFeeCache(property, -insuranceAmount.toNumber(), contractId);
            } catch (error) {
                console.error(`❌ Error processing insurance deposit for ${contractId}:`, error);
            }
        }
    }
}

static async updateAllPositions(blockHeight) {
  // Fetch all valid contract IDs (adjust this function to your environment)
  const contractIds = await ContractRegistry.getAllContractIds();

  for (const contractId of contractIds) {
    console.log(`Updating positions for contract ${contractId} at block ${blockHeight}`);

    // Load the margin map for this contract.
    const marginMap = await MarginMap.loadMarginMap(contractId);
    // Get the current positions stored in the margin map.
    const positions = await marginMap.getAllPositions();

    // Get contract details used in calculations.
    const contractInfo = await ContractRegistry.getContractInfo(contractId);
    const collateralPropertyId = contractInfo.collateralPropertyId;
    const notionalValue = contractInfo.notionalValue;
    const isInverse = contractInfo.inverse;

    // Loop through each position.
    for (const pos of positions) {
      // 1. Recalculate bankruptcy/liquidation prices.
      // Get the latest available balance and reserve from the tally.
      const tally = await TallyMap.getTally(pos.address, collateralPropertyId);
      const liqInfo = marginMap.calculateLiquidationPrice(
        tally.available,
        tally.margin,
        pos.contracts,
        notionalValue,
        isInverse,
        pos.contracts > 0, // isLong: positive means long, negative means short.
        pos.avgPrice
      );
      pos.liquidationPrice = liqInfo.liquidationPrice;
      pos.bankruptcyPrice = liqInfo.bankruptcyPrice;
      console.log(`For ${pos.address}: recalculated liqPrice = ${pos.liquidationPrice}, bankruptcyPrice = ${pos.bankruptcyPrice}`);

      // 2. Recalculate margin requirements.
      const initialMarginPerContract = await ContractRegistry.getInitialMargin(contractId, pos.avgPrice);
      const requiredMargin = new BigNumber(initialMarginPerContract)
        .times(Math.abs(pos.contracts))
        .toNumber();
      if (pos.margin < requiredMargin) {
        const marginDeficit = requiredMargin - pos.margin;
        console.log(`Adjusting margin for ${pos.address}: current margin ${pos.margin} is less than required ${requiredMargin}. Deficit: ${marginDeficit}`);
        // Force the margin up to the required level.
        pos.margin = requiredMargin;
        // Reflect this change in the tally (reserve vs. available).
        await TallyMap.updateBalance(
          pos.address,
          collateralPropertyId,
          marginDeficit,      // Increase margin (or move from reserve as needed)
          0,
          -marginDeficit,     // Deduct from reserve (example logic)
          0,
          'marginRequirementAdjustment',
          blockHeight
        );
      }

      // 3. Adjust orderbook orders for this address.
      // For example, if a position no longer qualifies for the "initialReduce" flag,
      // cancel or modify the orders. (Assumes Orderbooks.adjustOrdersForAddress exists.)
      await Orderbooks.adjustOrdersForAddress(pos.address, contractId, tally, pos);

      // Update the position in the margin map.
      marginMap.margins.set(pos.address, pos);
      console.log(`Final state for ${pos.address} on contract ${contractId}: contracts=${pos.contracts}, margin=${pos.margin}, liqPrice=${pos.liquidationPrice}`);
    }

    // Save the updated margin map for this contract.
    await marginMap.saveMarginMap(false);
  }
  console.log(`Finished updating positions for all contracts at block ${blockHeight}`);
}



   static async updateLastExchangeBlock(blockHeight) {
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

    static async fetchLiquidationVolume(contractId, blockHeight) {
        // Assuming you have a database method to fetch liquidation data
        try {
            const base = await db.getDatabase('clearing')
            const liquidationData = await base.findOneAsync({ _id: `liquidation-${contractId}-${blockHeight}` });
            return liquidationData ? liquidationData.volume : null; // Assuming 'volume' is the field you're interested in
        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log(`No liquidation data found for contract ID ${contractId} at block ${blockHeight}`);
                return null; // Handle case where data is not found
            }
            throw error; // Rethrow other types of errors
        }
    }

        /**
     * Loads clearing deltas from the clearing database for a given block height.
     * @param {number} blockHeight - The block height for which to load clearing deltas.
     * @returns {Promise<Array>} - A promise that resolves to an array of clearing deltas for the block.
     */
    static async loadClearingDeltasForBlock(blockHeight) {
        try {
            const clearingDeltas = [];
            const query = { blockHeight: blockHeight }; // Query to match the block height

            // Fetch the deltas from the database
            const base = await db.getDatabase('clearing')
            const results = await base.findAsync(query);
            results.forEach(doc => {
                clearingDeltas.push(doc.value); // Assuming each document has a 'value' field with the delta data
            });

            return clearingDeltas;
        } catch (error) {
            console.error('Error loading clearing deltas:', error);
            throw error;
        }
    }

    static async isPriceUpdatedForBlockHeight(contractId, blockHeight) {
        try {
            const ContractRegistry = require('./contractRegistry.js');
            const base = await db.getDatabase('oracleData');
            const volumeIndexDB = await db.getDatabase('volumeIndex');

            const isOracle = await ContractRegistry.isOracleContract(contractId);
            //console.log('oracle? '+isOracle)
            if (isOracle) {
                // Handle Oracle-based contracts
                const oracleId = await ContractRegistry.getOracleId(contractId);
                //console.log(`Checking Oracle price update for Oracle ID ${oracleId} at block height ${blockHeight}`);

                // Fetch oracle data
                const oracleData = await base.findAsync({ oracleId });
                if(!oracleData || oracleData.length === 0){
                    //console.warn(`No oracle data found for Oracle ID ${oracleId}`);
                    return false;
                }

                // Sort data by blockHeight
                oracleData.sort((a, b) => b.blockHeight - a.blockHeight);

                const [latestEntry, previousEntry] = oracleData;
                if (!previousEntry) {
                    //console.log(`Only one oracle data entry found for Oracle ID ${oracleId}. Assuming no price change.`);
                    return false;
                }

                const latestPrice = latestEntry.data.price;
                const previousPrice = previousEntry.data.price;
                  //console.log('ssdfs'+blockHeight+' '+latestEntry.blockHeight)
                    //console.log(`Oracle prices: latest=${latestPrice}, previous=${previousPrice}`);    
                //console.log('latest price obj '+JSON.stringify(latestPrice))              
                if(latestPrice!=previousPrice&&blockHeight==latestEntry.blockHeight){
                    console.log('ssdfs'+blockHeight+' '+latestEntry.blockHeight)
                    console.log(`Oracle prices: latest=${latestPrice}, previous=${previousPrice}`);    
                    return latestPrice
                }else{
                    return false
                }
            } else {
                const contractInfo = ContractRegistry.getContractInfo(contractId)
                // Handle Native contracts
                const pairKey = `${contractInfo.notionalPropertyId}-${contractInfo.collateralPropertyId}`;
                //console.log(`Checking native price update for pair ${pairKey} at block height ${blockHeight}`);

                // Fetch volume index data
                const volumeData = await volumeIndexDB.findAsync({ _id: pairKey });
                if (!volumeData || volumeData.length === 0) {
                    //console.warn(`No volume index data found for pair ${pairKey}`);
                    return false;
                }

                // Sort by blockHeight
                volumeData.sort((a, b) => b.value.blockHeight - a.value.blockHeight);

                const [latestEntry, previousEntry] = volumeData;

                if (!previousEntry) {
                    //console.log(`Only one volume index entry found for pair ${pairKey}. Assuming no price change.`);
                    return false;
                }

                const latestPrice = latestEntry.value.price;
                const previousPrice = previousEntry.value.price;
                if(latestPrice!=previousPrice&&blockHeight==latestEntry.blockHeight){
                    console.log(`Native prices: latest=${latestPrice}, previous=${previousPrice}`);
                    return latestPrice
                }else{
                    return false
                }
            }
        } catch (error) {
            console.error(`Error checking price update for contract ID ${contractId}:`, error.message);
            return false; // Default to no update in case of an error
        }
    }

    static async makeSettlement(blockHeight) {
            const ContractRegistry = require('./contractRegistry.js');
            const contracts = await ContractRegistry.loadContractSeries();
            //console.log(contracts)
            if(!contracts){return}
        for (const contract of contracts) {
            let id = contract[1].id
            // Check if there is updated price information for the contract
            //console.log('inside make settlement '+id+' '+blockHeight)
            const newPrice = await Clearing.isPriceUpdatedForBlockHeight(id, blockHeight)
            if (newPrice!=false) {
                console.log('new price '+newPrice)
                // Proceed with processing for this contract
                console.log('Making settlement for positions at block height:', JSON.stringify(contract) + ' ' + blockHeight);
                let collateralId = await ContractRegistry.getCollateralId(id)
                let inverse = await ContractRegistry.isInverse(id)
                const notionalValue = await ContractRegistry.getNotionalValue(id, newPrice)
                console.log('notional obj '+JSON.stringify(notionalValue))
                // Update margin maps based on mark prices and current contract positions
                let {positions, isLiq, systemicLoss} = await Clearing.updateMarginMaps(blockHeight, id, collateralId, inverse,notionalValue.notionalPerContract); //problem child
                console.log('is liq '+JSON.stringify(isLiq))
                console.log('length '+isLiq.length+' '+Boolean(isLiq.length>0))
                 // Perform additional tasks like loss socialization if needed
                if(isLiq.length>0){
                    await Clearing.performAdditionalSettlementTasks(blockHeight,positions,id,newPrice,systemicLoss,collateralId,systemicLoss);
                }
            } else {
                // Skip processing for this contract
                //console.log(`No updated price for contract ${contract.id} at block height ${blockHeight}`);
                continue;
            }
        }
        return
    }
    
    static async updateMarginMaps(blockHeight, contractId, collateralId, inverse, notional) {
        let liquidationData = [];
        let marginMap = await MarginMap.getInstance(contractId);
        let positions = await marginMap.getAllPositions(contractId);
        let blob = await Clearing.getPriceChange(blockHeight, contractId);
                          
        console.log('clearing price difference:', blob.lastPrice, blob.thisPrice);
        let isLiq = [];
        let systemicLoss = 0;

        for (let i = 0; i < positions.length; i++) {
            let position = positions[i];
            let orderbook = await Orderbooks.getOrderbookInstance(contractId);
            //if(position.contracts==null){throw new Error()}
            console.log('position before '+JSON.stringify(positions))
            const tally = await TallyMap.getTally(position.address,collateralId)
            console.log('just checking '+position.address)
            const {liquidationPrice,bankruptcyPrice} = await marginMap.calculateLiquidationPrice(tally.available, tally.margin,position.contracts,notional,inverse,Boolean(position.contracts>0),position.avgPrice)
            position.liquidationPrice = liquidationPrice
            position.bankruptcyPrice = bankruptcyPrice
            if(position.contracts==0){continue}
            if(!blob.lastPrice){
                console.log('last price was null, using avg price:', position.avgPrice);
                blob.lastPrice = position.avgPrice;
            }
            console.log('🔄 position '+JSON.stringify(position))

            let pnlChange = await Clearing.calculatePnLChange(position, blob.thisPrice, blob.lastPrice, inverse, notional);
            console.log(`Processing position: ${JSON.stringify(position)}, PnL change: ${pnlChange}`);

            let newPosition = await marginMap.clear(position, position.address, pnlChange, position.avgPrice, contractId,blockHeight);
            if(pnlChange>0){
                await TallyMap.updateBalance(position.address, collateralId, pnlChange, 0, 0, 0, 'clearing', blockHeight);
            }else{
                let balance = await TallyMap.hasSufficientBalance(position.address, collateralId, Math.abs(pnlChange));
                console.log(`Checking balance for ${position.address}:`, balance);

                if(balance.hasSufficient){
                    await TallyMap.updateBalance(position.address, collateralId, pnlChange, 0, 0, 0, 'clearing', blockHeight);
                }else{
                    let tally = await TallyMap.getTally(position.address, collateralId);
                    let totalCollateral = tally.available + tally.margin;
                    let marginDent = new BigNumber(Math.abs(pnlChange)).minus(new BigNumber(tally.available)).decimalPlaces(8).toNumber();

                    if(totalCollateral > Math.abs(pnlChange) && marginDent < tally.margin) {
                        await TallyMap.updateBalance(position.address, collateralId, -tally.available, 0, -marginDent, 0, 'clearingLoss', blockHeight);
                        await marginMap.updateMargin(position.address, contractId, -marginDent);
                        if (await marginMap.checkMarginMaintainance(position.address, contractId,position)){
                            let liquidationResult = await Clearing.handleLiquidation(marginMap, orderbook, TallyMap, position, contractId, blockHeight, inverse, collateralId, "partial",marginDent);
                            if (liquidationResult) {
                                if(liquidationResult.counterparties.length>0){
                                            console.log(JSON.stringify(liquidationResult.counterparties))
                                            console.log("Before update:", JSON.stringify(positions, null, 2));
                                            positions = Clearing.updatePositions(positions, liquidationResult.counterparties);
                                            console.log("After update:", JSON.stringify(positions, null, 2));
                                }
                                isLiq.push(liquidationResult.liquidation);
                                systemicLoss += liquidationResult.systemicLoss;
                            }
                        }
                    } else {
                        console.log('Danger zone! Margin is insufficient:', totalCollateral, pnlChange, marginDent, tally.margin);
                        let cancelledOrders = await orderbook.cancelAllOrdersForAddress(position.address, contractId, blockHeight, collateralId);
                        let postCancelBalance = await TallyMap.hasSufficientBalance(position.address, collateralId, marginDent);

                        if (postCancelBalance.hasSufficient) {
                            await TallyMap.updateBalance(position.address, collateralId, -marginDent, 0, 0, 0, 'clearingLossPostCancel', blockHeight);
                            continue;
                        } else {
                            let postCancelTally = await TallyMap.getTally(position.address, collateralId);
                            if (Math.abs(postCancelBalance.shortfall) < tally.margin) {
                                await TallyMap.updateBalance(position.address, collateralId, -postCancelTally.available, 0, -postCancelBalance.shortfall, 0, 'clearingLossPostCancel', blockHeight);
                                if (await marginMap.checkMarginMaintainance(position.address, contractId)) {
                                    let liquidationResult = await Clearing.handleLiquidation(marginMap, orderbook, TallyMap, position, contractId, blockHeight, inverse, collateralId, "partial",marginDent,notional);
                                    
                                            console.log("Before update:", JSON.stringify(positions, null, 2));
                                    if (liquidationResult) {
                                        if(liquidationResult.counterparties.length>0){
                                            console.log(JSON.stringify(liquidationResult.counterparties))
                                            positions = Clearing.updatePositions(positions, liquidationResult.counterparties);
                                            console.log("After update:", JSON.stringify(positions, null, 2));
                                        }
                                        isLiq.push(liquidationResult.liquidation);
                                        systemicLoss += liquidationResult.systemicLoss;
                                    }
                                }
                                continue;
                            } else {
                                let liquidationResult = await Clearing.handleLiquidation(marginMap, orderbook, TallyMap, position, contractId, blockHeight, inverse, collateralId, "total",null,notional);
                                console.log("Before update:", JSON.stringify(liquidationResult));
                                if (liquidationResult) {
                                    if(liquidationResult.counterparties.length>0){
                                            console.log(JSON.stringify(liquidationResult.counterparties))
                                             positions = Clearing.updatePositions(positions, liquidationResult.counterparties);
                                            console.log("🔄 After update:", JSON.stringify(positions, null, 2));
                                    }
                                    isLiq.push(liquidationResult.liquidation);
                                    systemicLoss += liquidationResult.systemicLoss;
                                }
                            }
                        }
                    }
                }
            }
        }

        positions.lastMark = blob.lastPrice;
        console.log('systemic loss '+systemicLoss)
        await marginMap.saveMarginMap(false);
        return { positions, isLiq, systemicLoss };
    }

static updatePositions(positions, updatedCounterparties) {
    //console.log('updated counterparties '+JSON.stringify(updatedCounterparties))
    if(!updatedCounterparties){return positions}
    const counterpartyMap = new Map(updatedCounterparties.map(pos => [pos.address, pos]));

    return positions.map(pos => 
        counterpartyMap.has(pos.address) 
            ? { ...pos, ...counterpartyMap.get(pos.address) }  // Merge updated counterparty data
            : pos  // Keep the original position if no update
    );
}

static async handleLiquidation(marginMap, orderbook, tallyMap, position, contractId, blockHeight, inverse, collateralId, liquidationType, marginDent, notional) {
    let isFullLiquidation = liquidationType === "total";
    let isPartialLiquidation = liquidationType === "partial";

    console.log(`Handling ${liquidationType} liquidation for ${position.address} on contract ${contractId}`);

    // Step 1: Generate the liquidation order
    let liq = await marginMap.generateLiquidationOrder(position, contractId, isFullLiquidation,blockHeight);
    if (liq === "err:0 contracts") {
        console.log("No contracts to liquidate.");
        return null;
    }

    // Step 2: Estimate liquidation impact on the orderbook
    let splat = await orderbook.estimateLiquidation(liq);
    console.log(`🛑 Liquidation Order: ${JSON.stringify(liq)}, Orderbook Response: ${JSON.stringify(splat)}`);
    
    // Adjust liquidation size based on actual matches
    liq.amount = splat.filledSize;
    if(splat.filledBelowLiqPrice||splat.partiallyFilledBelowLiqPrice){
        liq.price=splat.trueLiqPrice
        if(isPartialLiquidation&&((splat.estimatedFillPrice<bankruptcyPrice&&liq.sell==true)||(splat.estimatedFillPrice>bankruptcyPrice&&liq.sell==false))){
            isFullLiquidation==true
            isPartialLiquidation==false
            liq = await marginMap.generateLiquidationOrder(position, contractId, isFullLiquidation,blockHeight);
        }
    }

    let marginReduce = position.margin;
    if (liquidationType === "partial") {
        marginReduce = marginDent;
    }

     const infoBlob = { posMargin: position.margin, reduce: marginReduce, dent: marginDent };

    // Step 3: Adjust margin & balances
     console.log('🏦 about to update contracts for liq' + position.margin + ' ' + marginReduce + ' ' + JSON.stringify(position));
 
    position = await marginMap.updateContractBalances(position.address, liq.amount, liq.price, !liq.sell, position, inverse, true, false, contractId, false, true);
    await tallyMap.updateBalance(position.address, collateralId, 0, 0, -marginReduce, 0, "clearingLoss", blockHeight);
    position = await marginMap.updateMargin(position.address, contractId, -marginReduce);

    const orderbookKey= contractId.toString()
        let orderbookData = orderbook.orderBooks[orderbookKey] || { buy: [], sell: [] };
        console.log('🛑 liq JSON '+JSON.stringify(liq))    
        orderbookData = await orderbook.insertOrder(liq, orderbookData, liq.sell, true);
        let matchResult = await orderbook.matchContractOrders(orderbookData);
        console.log('match Result '+matchResult.matches.length+' '+JSON.stringify(matchResult))
        if (matchResult.matches.length > 0) {
            console.log('🛑 liq matches '+JSON.stringify(matchResult.matches))
            const trade = await orderbook.processContractMatches(matchResult.matches, blockHeight, false);
            console.log('trade result '+JSON.stringify(trade))
            await orderbook.saveOrderBook(matchResult.orderBook,orderbookKey);

        }

    let systemicLoss = new BigNumber(0);
    let caseLabel = "";
    let result = {counterparties:[]};

    // Step 4: Handle different liquidation scenarios
    if (!splat.filled) {
        const remainder = splat.remainder;
        const lossBN = new BigNumber(splat.liquidationLoss);
        systemicLoss = systemicLoss.plus(lossBN).decimalPlaces(8);

        if (splat.partiallyFilledBelowLiqPrice) {
            caseLabel = "CASE 2: Partial fill above, remainder filled below liquidation price.";
            result = await marginMap.simpleDeleverage(contractId, remainder, liq.sell, liq.price, position.address, inverse, notional, blockHeight);
        } else if (splat.filledBelowLiqPrice && splat.remainder === 0) {
            caseLabel = "CASE 3: Fully filled but below liquidation price - Systemic loss.";
        } else if (splat.filledBelowLiqPrice && splat.remainder > 0) {
            caseLabel = "CASE 4: Order partially filled, but book is exhausted.";
            console.log(caseLabel);
            result = await marginMap.simpleDeleverage(contractId, remainder, liq.sell, liq.price, position.address, inverse, notional,blockHeight);
        } else if (splat.trueBookEmpty) {
            caseLabel = "CASE 5: No liquidity available at all - full deleveraging needed.";
            console.log('about to call simple deleverage in case 5 ' + contractId + ' ' + remainder + ' ' + liq.sell + ' ' + liq.price);
            result = await marginMap.simpleDeleverage(contractId, remainder, liq.sell, liq.price, position.address, inverse, notional,blockHeight);
        }
    } 

        const deleverageAmount = result.totalDeleveraged || 0
        console.log('about to remove deleveraged contracts from liq addr '+position.address+' '+deleverageAmount+' '+JSON.stringify(result))
        position = await marginMap.updateContractBalances(position.address, deleverageAmount, liq.price, !liq.sell, position, inverse, true, false, contractId, false, true);
   
        console.log('🏦 showing counterparties before merge with trades '+JSON.stringify(result.counterparties))
        const counterparties = await Clearing.extractCounterpartyPositions(matchResult.matches,result.counterparties,marginMap,contractId)
        console.log('🏦 showing counterparties after merge with trades '+JSON.stringify(counterparties))
       
    // Step 5: Save liquidation results
    await marginMap.saveLiquidationOrders(contractId, position, liq, caseLabel, blockHeight, systemicLoss.toNumber(), splat.remainder, splat.trueLiqPrice, result, infoBlob);

    return { liquidation: liq, systemicLoss: systemicLoss.toNumber(), counterparties: counterparties || [] };
}

static async extractCounterpartyPositions(matches, deleveragedPositions, marginMap, contractId) {
  // Create a set to store unique addresses
  const addresses = new Set();

  // Collect addresses from the matches array (which come from liq order matching)
  for (const match of matches) {
    if (match.buyerPosition && match.buyerPosition.address) {
      addresses.add(match.buyerPosition.address);
    }
    if (match.sellerPosition && match.sellerPosition.address) {
      addresses.add(match.sellerPosition.address);
    }
  }

     if (Array.isArray(deleveragedPositions)) {
      for (const pos of deleveragedPositions) {
        if (addresses.has(pos.address)) {
          addresses.delete(pos.address);
        }
      }
    }


  // Now build the merged array using the latest DB entry for each address.

  for (const address of addresses) {
    let updatedPos = await marginMap.getPositionForAddress(address, contractId);
    // If not found, optionally fallback to the in-memory map:
    if (!updatedPos && marginMap.margins && typeof marginMap.margins.get === 'function') {
      updatedPos = marginMap.margins.get(address);
    }
    if (updatedPos) {
      deleveragedPositions.push(updatedPos);
    }
  }

  return deleveragedPositions;
}

static sortPositionsForPNL(positions, priceDiff) {
    return positions.sort((a, b) => {
        if (priceDiff) {
            // Price is increasing -> Shorts should go first
            return a.contracts - b.contracts;
        } else {
            // Price is decreasing -> Longs should go first
            return b.contracts - a.contracts;
        }
    });
}

    static async getPriceChange(blockHeight, contractId) {
        const ContractRegistry = require('./contractRegistry.js');
        let isOracleContract = await ContractRegistry.isOracleContract(contractId);
        let oracleId = null;
        let propertyId1 = null;
        let propertyId2 = null;
        let latestData = [];

        if (isOracleContract) {
            oracleId = await ContractRegistry.getOracleId(contractId);
            const base = await db.getDatabase('oracleData');
            latestData = await base.findAsync({ oracleId: oracleId });

        } else {
            console.log('Inside getPriceChange() for native contract');
            let info = await ContractRegistry.getContractInfo(contractId);
            propertyId1 = info?.native?.onChainData?.[0];
            propertyId2 = info?.native?.onChainData?.[1];
            
            if (!propertyId1 || !propertyId2) {
                console.warn(`No valid properties found for contract ${contractId}`);
                return { lastPrice: null, thisPrice: null };
            }

            latestData = await volumeIndexDB.findAsync({ propertyId1, propertyId2 });
        }

    // Ensure data is an array before sorting
    const sortedData = Array.isArray(latestData) ? latestData.sort((a, b) => b.blockHeight - a.blockHeight) : [];
    if (sortedData.length === 0) {
        console.warn(`No price data found for contract ${contractId}`);
        return { lastPrice: null, thisPrice: null };
    }

    // Get latest and previous prices
    const latestBlockData = sortedData[0]; // Most recent entry
    const currentMarkPrice = latestBlockData?.data?.price || null;
    const previousMarkPrice = sortedData.length > 1 ? sortedData[1]?.data?.price : null;

    console.log(`Checking mark price: Current=${currentMarkPrice}, Previous=${previousMarkPrice}`);
    
    return { lastPrice: previousMarkPrice, thisPrice: currentMarkPrice };
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

        console.log('clearing PNL ' +priceBN +' '+currentMarkPrice+' '+avgPriceBN+' ' +previousMarkPrice+' '+contractsBN+' '+position.contracts+' '+notionalValueBN+' '+notionalValue)
        // Adjust sign based on whether the position is long or short
        if(contractsBN<0){
            pnl.times(-1)
        }
        //pnl = position.contracts>0 ? pnl : pnl.negated();
        console.log('pnl '+pnl.toNumber())
        return pnl.decimalPlaces(8).toNumber();
    }

    static async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress);
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error);
            throw error;
        }
    }

    static async performAdditionalSettlementTasks(blockHeight,positions, contractId, mark,totalLoss,collateralId){
        console.log('herro '+blockHeight+' '+JSON.stringify(positions)+' '+contractId+' '+mark+' '+totalLoss+' '+collateralId)
        //try {
            // Step 2: Check if insurance fund payout is needed
            if (Math.abs(totalLoss) > 0) {
                // Step 3: Apply insurance fund payout
                const ContractRegistry = require('./contractRegistry.js');
                let isOracleContract = await ContractRegistry.isOracleContract(contractId);
                const insurance = await Insurance.getInstance(contractId,isOracleContract)
                const payout = await insurance.calcPayout(totalLoss, blockHeight);
                console.log('🏦 insurance payout '+payout)
                // Step 4: Socialize remaining loss if any
                const remainingLoss = totalLoss - payout;
                console.log('remaining loss '+remainingLoss)
                if (Math.abs(remainingLoss) > 0) {
                    await Clearing.socializeLoss(contractId, remainingLoss);
                }
            }
        //} catch (error) {
        //    console.error('Error performing additional settlement tasks:', error);
        //    throw error;
        //}
    }


    static async auditSettlementTasks(blockHeight, positions) {
        try {
            // Check total margin consistency
            let totalMargin = this.calculateTotalMargin(positions);
            if (!this.isMarginConsistent(totalMargin)) {
                throw new Error("Inconsistent total margin detected");
            }

            // Verify insurance fund balance is not negative
            if (Insurance.getBalance() < 0) {
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

    static async saveClearingSettlementEvent(contractId, settlementDetails, blockHeight) {
        const clearingDB = await dbInstance.getDatabase('clearing');
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

    static async loadClearingSettlementEvents(contractId, startBlockHeight = 0, endBlockHeight = Number.MAX_SAFE_INTEGER) {
        const clearingDB = await dbInstance.getDatabase('clearing');
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

    static async getBalance(holderAddress) {
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
    static calculateTotalMargin(positions) {
        let totalMargin = 0;
        positions.forEach(position => {
            totalMargin += position.margin;  // Assuming each position object has a 'margin' property
        });
        return totalMargin;
    }

    static isMarginConsistent(totalMargin) {
        const expectedMargin = this.getExpectedTotalMargin(); // Implement this method based on your system
        // You can also implement a range-based check instead of an exact value match
        return totalMargin === expectedMargin;
    }

    static async saveAuditIndex(blockHeight) {
        const auditData = this.prepareAuditData(); // Implement this method to prepare data for saving
        try {
            await database.saveAuditData(blockHeight, auditData);
        } catch (error) {
            console.error('Error saving audit index for block height:', blockHeight, error);
            throw error;
        }
    }

    static prepareAuditData(blockHeight, positions, balanceChanges) {
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

static async socializeLoss(contractId, totalLoss) {
    //try {
        console.log(`🔹 Socializing loss for contract ${contractId}, total loss: ${totalLoss}`);
        const margins = await MarginMap.getInstance(contractId)
        // Get all positions
        const openPositions = await margins.getAllPositions();

        // Filter only positions with positive uPNL
        const positiveUPNLPositions = openPositions.filter(pos => new BigNumber(pos.unrealizedPNL).gt(0));

        if (positiveUPNLPositions.length === 0) {
            console.log("⚠️ No positive uPNL positions found. No loss to socialize.");
            return;
        }

        // Calculate total positive uPNL
        const totalUPNL = positiveUPNLPositions.reduce((sum, pos) => sum.plus(pos.unrealizedPNL), new BigNumber(0));

        if (totalUPNL.isZero()) {
            console.log("⚠️ Total positive uPNL is zero. No loss to socialize.");
            return;
        }

        // Calculate loss percentage
        const lossPercentage = new BigNumber(totalLoss).dividedBy(totalUPNL);

        console.log(`📊 Total uPNL: ${totalUPNL.toFixed(4)}, Loss Percentage: ${(lossPercentage.times(100)).toFixed(2)}%`);

        // Apply proportional loss to positive uPNL positions
        for (let pos of positiveUPNLPositions) {
            const lossForPosition = new BigNumber(pos.unrealizedPNL).times(lossPercentage).decimalPlaces(8);

            console.log(`📉 Reducing ${pos.address} uPNL by ${lossForPosition.toFixed(8)} (original: ${pos.unrealizedPNL})`);

            // Adjust uPNL
            pos.unrealizedPNL = new BigNumber(pos.unrealizedPNL).minus(lossForPosition).toNumber();

            // Update margin map
            this.margins.set(pos.address, pos);
            await this.recordMarginMapDelta(
                pos.address,
                contractId,
                0, 0, 0,
                -lossForPosition.toNumber(), // Deducted uPNL
                0,
                'socializeLoss'
            );
        }

        // Save updated margin map
        await this.saveMarginMap(true);

        console.log("✅ Socialized loss successfully applied.");

    //} catch (error) {
    //    console.error("❌ Error socializing loss:", error);
    //    throw error;
    //}
}


    static async fetchAuditData(auditDataKey) {
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