// Assuming the LevelDB database is stored at './path_to_margin_db'
const db = require('./db.js');
const BigNumber = require('bignumber.js')
const { v4: uuidv4 } = require('uuid');


class MarginMap {
    constructor(seriesId) {
        this.seriesId = seriesId;
        this.margins = new Map();
    }

    static async getInstance(contractId) {
        // Load the margin map for the given contractId from the database
        // If it doesn't exist, create a new instance
        const marginMap = await MarginMap.loadMarginMap(contractId);
        return marginMap;
    }

    static async loadMarginMap(seriesId,flag) {
        const key = JSON.stringify({ seriesId });
        //console.log('loading margin map for ' + seriesId);
        // Retrieve the marginMaps database from your Database instance
        const marginMapsDB = await db.getDatabase('marginMaps');

        try {
            const doc = await marginMapsDB.findOneAsync({ _id: key });
            if (!doc) {
                // Return a new instance if not found
                //console.log('no MarginMap found, spinning up a fresh one');
                return new MarginMap(seriesId);
            }

            if(flag){console.log('marginMap parsed from DB ' + JSON.stringify(doc));}
            const map = new MarginMap(seriesId);

            // Parse the value property assuming it's a JSON string
            const parsedValue = JSON.parse(doc.value);
            
            if (parsedValue instanceof Array) {
                // Assuming parsedValue is an array
                map.margins = new Map(parsedValue);
            } else {
                console.error('Error parsing margin map value. Expected an array.');
            }

            //console.log('returning a map from the file ' + JSON.stringify(map.margins));
            return map;
        } catch (err) {
            console.error('Error loading margin Map ' + err);
        }
    }

    /*static async loadMarginMap(seriesId) {
        const key = JSON.stringify({ seriesId});
        console.log('loading margin map for '+seriesId)
        // Retrieve the marginMaps database from your Database instance
        const marginMapsDB = db.getDatabase('marginMaps');

        try {
            const doc = await marginMapsDB.findOneAsync({ _id: key });
            if (!doc) {
                // Return a new instance if not found
                console.log('no MarginMap found, spinning up a fresh one')
                return new MarginMap(seriesId);
            }
            console.log('marginMap parsed from DB '+JSON.stringify(doc))
            var map = new MarginMap(seriesId);
            map.margins = new Map(JSON.parse(doc.value));
            console.log('returning a map from the file '+JSON.stringify(map))
            return map;
        } catch (err) {
            console.log('err loading margin Map '+err)
        }
    }*/

    /*initMargin(address, contracts, price) {
        const notional = contracts * price;
        const margin = notional * 0.1;

        this.margins.set(address, {
            contracts,
            margin,
            unrealizedPl: 0
        });

        return margin;
    }*/
    async getAllPositions(contractId,flag) {
        let map = await MarginMap.loadMarginMap(contractId,flag);

        // If the margins map is empty, attempt to reload from the database
        /*if (!map.margins || map.margins.size === 0) {
            //console.log(`🔄 Margins map empty for contract ${contractId}, reloading from DB...`);
            map = await MarginMap.loadMarginMap(contractId);  // Assuming this method exists
        }*/

        //console.log(`📊 Getting positions for contract ${contractId}:`, JSON.stringify([...map.margins]));

        const allPositions = [];
        for (const [address, position] of map.margins.entries()) {
            if (!address) continue;

            allPositions.push({
                address: address,
                contracts: position.contracts,
                margin: position.margin,
                unrealizedPNL: position.unrealizedPNL,
                avgPrice: position.avgPrice,
                liqPrice: position.liqPrice,
                bankruptcyPrice: position.bankruptcyPrice,
                newPosThisBlock: position.newPosThisBlock
                // Add other relevant fields if necessary
            });
        }
        return allPositions;
    }

// Set initial margin for a new position in the MarginMap
    async setInitialMargin(sender, contractId, totalInitialMargin,block) {
        console.log('setting initial margin '+sender, contractId, totalInitialMargin)
        
        // Check if there is an existing position for the sender
        let position = this.margins.get(sender);

        console.log('setting initial margin position '+JSON.stringify(position))

        if (!position) {
            // If no existing position, initialize a new one
            position = {
                contracts: 0,  // Number of contracts the sender has
                margin: 0,
                unrealizedPNL:0      // Total margin amount the sender has posted
            };
        }

        //console.log('margin before '+position.margin)
        // Update the margin for the existing or new position
        position.margin = new BigNumber(position.margin)
        .plus(totalInitialMargin)
        .decimalPlaces(8)
        .toNumber();
        console.log('aftermargin  '+position.margin)
        // Update the MarginMap with the modified position
        if(sender==null){throw new Error()}
        this.margins.set(sender, position);
        //console.log('margin should be topped up '+JSON.stringify(position))
        await this.recordMarginMapDelta(sender, contractId, position.contracts, 0, totalInitialMargin, 0, 0, 'initialMargin', block)
         // Save changes to the database or your storage solution
        await this.saveMarginMap(true);
        return position
    }

      // add save/load methods
    async saveMarginMap(block) {
        console.log('saving margin map')
        try {
            const key = JSON.stringify({ seriesId: this.seriesId });
            const marginMapsDB = await db.getDatabase('marginMaps');
            const value = JSON.stringify([...this.margins]);
            console.log(value)
                    // Save the margin map to the database
            await marginMapsDB.updateAsync({ _id: key }, { $set: {block: block, value: value}},{upsert: true})
            //await marginMapsDB.loadDatabase();
            //console.log('MarginMap saved successfully.');
        } catch (err) {
            console.error('Error saving MarginMap:', err);
            throw err;
        }
    }

    async updateContractBalancesWithMatch(match, channelTrade, close,flip,block) {
        console.log('updating contract balances, buyer '+JSON.stringify(match.buyerPosition)+ '  and seller '+JSON.stringify(match.sellerPosition))
        console.log('with match '+JSON.stringify(match))
        let buyerPosition = await this.updateContractBalances(
            match.buyOrder.buyerAddress,
            match.buyOrder.amount,
            match.tradePrice,
            true,
            match.buyerPosition,
            match.inverse,
            close,
            flip,
            match.buyOrder.contractId,
            match.buyOrder.isLiq,
            block
        );

        let sellerPosition = await this.updateContractBalances(
            match.sellOrder.sellerAddress,
            match.sellOrder.amount,
            match.tradePrice,
            false,
            match.sellerPosition,
            match.inverse,
            close,
            flip,
            match.sellOrder.contractId,
            match.sellOrder.isLiq,
            block
        );
        return {bp: buyerPosition, sp: sellerPosition}
    }

    async updateContractBalances(address, amount, price, isBuyOrder,position, inverse, close,flip,contractId,inClearing,block,initial) {
        console.log('pre-liq check in update contracts '+amount+' '+JSON.stringify(position))
        if(position.contracts==null){position.contracts=0}
        if (position.newPosThisBlock === undefined) {
             position.newPosThisBlock = 0;
        }
        //const position = this.margins.get(address) || this.initMargin(address, 0, price);
        //console.log('updating the above position for amount '+JSON.stringify(position) + ' '+amount + ' price ' +price +' address '+address+' is buy '+isBuyOrder)
        //calculating avg. price
        console.log('inside updateContractBalances '+close +' '+flip+' position '+position.contracts+' avg. price '+position.avgPrice)
        if(close==false&&flip==false){
            if(position.contracts==0){
                if(position.avgPrice==undefined||position.avgPrice==null){
                    position.avgPrice=price
                    console.log('setting avg. price as trade price for new position '+position.avgPrice)
                }else{
                    position.avgPrice=price
                }
            }else{
                console.log('about to call updateAveragePrice '+amount+' '+price+' '+contractId)
                position.avgPrice=await this.updateAveragePrice(position,amount,price,contractId, isBuyOrder)
                console.log('after the avg price function '+position.avgPrice)
            }
        }else if(flip==true&&close==false){
            //this is the first trade in the new direction of the flip so its price is the avg. entry price
            position.avgPrice=price
        }

        // For buy orders, increase contracts and adjust margin
        // Calculate the new position size and margin adjustment
        console.log('position size before update '+position.contracts)
        const amountBN = new BigNumber(amount)
        let newPositionSize = isBuyOrder ? BigNumber(position.contracts).plus(amountBN).toNumber() : BigNumber(position.contracts).minus(amountBN).toNumber();
        console.log('new newPositionSize '+newPositionSize + ' address '+ address + ' amount '+ amount + ' isBuyOrder '+isBuyOrder)
        //if(newPositionSize==null){newPositionSize=amount}
        position.contracts=newPositionSize
        
        const ContractList = require('./contractRegistry.js')
        const TallyMap = require('./tally.js')
        const contractInfo = await ContractList.getContractInfo(contractId)
        console.log('contract Info in updateContractBalances' + JSON.stringify(contractInfo))
        const notionalValue = contractInfo.notionalValue
        const collateralId = contractInfo.collateralPropertyId
        console.log('about to call getTally in updateContractBalances '+address +' '+collateralId)
        const balances = await TallyMap.getTally(address,collateralId)
        console.log(JSON.stringify(balances))
        const available = balances.available
        console.log('about to call calc liq price '+available +' '+position.margin+' '+position.contracts+' '+notionalValue+' '+inverse+' '+'avg entry '+position.avgPrice)
        const isLong = position.contracts>0? true: false
        console.log('isLong '+isLong)
        const liquidationInfo = this.calculateLiquidationPrice(available, position.margin, position.contracts, notionalValue, inverse,isLong, position.avgPrice);
        console.log('liquidation info ' +JSON.stringify(liquidationInfo));
        
        if(liquidationInfo==null||position.contracts==0){
            position.liqPrice=0
            position.bankruptcyPrice=0
            position.avgPrice=price
        }else{
            position.liqPrice = liquidationInfo.liquidationPrice || null
            position.bankruptcyPrice = liquidationInfo.bankruptcyPrice  
            console.log('position with possible nulls '+JSON.stringify(position)) 
        }
        if(address==null){throw new Error()}
        
        if(isBuyOrder&&!inClearing){
            position.newPosThisBlock+=amount
            console.log('buy order not in clearing '+position.newPosThisBlock)
        }else if(!isBuyOrder&&!inClearing){
            position.newPosThisBlock-=amount
            console.log('sell order not in clearing '+position.newPosThisBlock)
        }else{
            console.log('in clearing '+position.newPosThisBlock)
        }


        this.margins.set(address, position);  
        let tag = 'updateContractBalances'
        if(inClearing){
            tag = 'liquidatingContract'
            if(initial){
                tag = 'initialLiq'
            }
        }

        if(position.bankruptcyPrice===undefined){
            console.log('missing liq prices in position '+JSON.stringify(position))
            throw new Error()
            position.bankruptcyPrice=0
        }
        console.log('✅ position before saving to marginMap '+JSON.stringify(position))
        await this.saveMarginMap(block)
        await this.recordMarginMapDelta(address, contractId, newPositionSize, amount,0,0,0,tag,block,liquidationInfo.bankruptcyPrice)
        return position
    }
    
    calculateLiquidationPrice(available, margin, contracts, notionalValue, isInverse, isLong, avgPrice,uPNL) {
        const balanceBN = new BigNumber(available);
        const marginBN = new BigNumber(margin);
        let uPNLBN = 0
        if(uPNL<0){
            uPNLBN = new BigNumber(Math.abs(uPNL))
        }
        const contractsBN = new BigNumber(Math.abs(contracts));
        const notionalValueBN = new BigNumber(notionalValue);
        const avgPriceBN = new BigNumber(avgPrice);

        // For linear contracts, use your existing formulas.
        const totalCollateralBN = balanceBN.plus(marginBN).plus(uPNLBN);
        const positionNotional = notionalValueBN.times(contractsBN);
        let bankruptcyPriceBN = new BigNumber(0);
        let liquidationPriceBN = new BigNumber(0);
        const adjustment = marginBN.dividedBy(2).dividedBy(contractsBN); // This is used for linear

        console.log('inside calc liq price', isInverse, isLong, 'avail and margin', available, margin);
        
        if (!isInverse) {
            // Linear contracts: existing logic
            if (isLong) {
                if (totalCollateralBN.isGreaterThanOrEqualTo(positionNotional.times(avgPriceBN))) {
                    return { bankruptcyPrice: null, liquidationPrice: null };
                } else {
                    bankruptcyPriceBN = avgPriceBN.minus(totalCollateralBN.dividedBy(positionNotional)).times(1.005);
                    liquidationPriceBN = bankruptcyPriceBN.plus(adjustment);
                }
            } else {
                bankruptcyPriceBN = avgPriceBN.plus(totalCollateralBN.dividedBy(positionNotional)).times(0.995);
                liquidationPriceBN = bankruptcyPriceBN.minus(adjustment);
            }
        } else {
            // Inverse contracts: use reciprocal PnL logic.
            // Define term = (margin / 2) / (contracts * notional)
            const term = marginBN.dividedBy(2).dividedBy(contractsBN.multipliedBy(notionalValueBN));

            if (isLong) {
                // For a long inverse position:
                // 1/Pliq = 1/Pentry + term  => Pliq = 1 / (1/Pentry + term)
                const reciprocalLiq = new BigNumber(1).dividedBy(avgPriceBN).plus(term);
                liquidationPriceBN = new BigNumber(1).dividedBy(reciprocalLiq);
                // For bankruptcy, you might apply a slight multiplier:
                const reciprocalBankruptcy = new BigNumber(1).dividedBy(avgPriceBN).plus(term.multipliedBy(1.005));
                bankruptcyPriceBN = new BigNumber(1).dividedBy(reciprocalBankruptcy);
            } else {
                // For a short inverse position:
                // 1/Pliq = 1/Pentry - term. If that term becomes <= 0, liquidation price is null.
                const reciprocalLiq = new BigNumber(1).dividedBy(avgPriceBN).minus(term);
                if (reciprocalLiq.lte(0)) {
                    return { bankruptcyPrice: null, liquidationPrice: null };
                } else {
                    liquidationPriceBN = new BigNumber(1).dividedBy(reciprocalLiq);
                    // Bankruptcy price with a slight multiplier:
                    const reciprocalBankruptcy = new BigNumber(1).dividedBy(avgPriceBN).minus(term.multipliedBy(1.005));
                    bankruptcyPriceBN = new BigNumber(1).dividedBy(reciprocalBankruptcy);
                }
            }
        }

        let bankruptcyPrice = Math.abs(bankruptcyPriceBN.decimalPlaces(4).toNumber());
        let liquidationPrice = Math.abs(liquidationPriceBN.decimalPlaces(4).toNumber());
        
        return {
            bankruptcyPrice,
            liquidationPrice
        };
    }

    async updateAveragePrice(position, amount, price, contractId, isBuy) {
        // Make sure our absolute value order amounts for sells register
        if (!isBuy) {
            amount *= -1;
        }

        // Convert existing values to BigNumber
        const avgPrice = new BigNumber(position.avgPrice || 0);
        const contracts = new BigNumber(position.contracts || 0);
        const amountBN = new BigNumber(amount);
        const priceBN = new BigNumber(price);
   
       console.log('inside update Avg. ' + position.avgPrice + ' ' + position.contracts + ' ' + amount + ' ' + price);
        
        // Calculate the numerator and denominator separately for clarity
        const numerator = avgPrice.times(contracts).plus(amountBN.times(priceBN));
        const denominator = contracts.plus(amountBN);
        
        // Calculate the updated average price
        const updatedAvgPrice = numerator.dividedBy(denominator);
            
        console.log('updated avg ' + updatedAvgPrice);
        
        // Update the position object with the new values
        position.avgPrice = updatedAvgPrice.abs().decimalPlaces(4).toNumber(); // Keep the avgPrice positive
        //position.contracts = contracts.plus(amountBN).toNumber(); // Update the contracts

        await this.recordMarginMapDelta(position.address, contractId, 0, 0, 0, 0, (avgPrice.toNumber() - updatedAvgPrice.abs().toNumber()), 'newAvgPrice');
        
        // Return the updated position object
        return position.avgPrice;
    }

    async moveMarginAndContractsForMint(address, propertyId, contractId, contracts, margin,block) {
        // Check if the margin map exists for the given contractId
        const position = this.margins.get(address);
        const synthId = 's-'+propertyId+'-'+contractId

        let vaultPosition = this.margins.get(synthId)
        let first = false

        if(!vaultPosition){
            console.log('first time establishing vault on marginMap '+synthId)
            first = true
            vaultPosition = {contracts:0,margin:0,avgPrice:0,liqPrice:null,address:synthId}
        }
        // If no position exists for the propertyId, initialize a new one
        if (!position) {
            return console.log('error: no position found for mint with '+propertyId+' collateral and contract '+contractId)
        }
        let excess = 0
        //we're assuming contracts is a negative number reflecting funky math in the validity function
        console.log('inside moveMarginAndContractsForMint '+contracts, margin, position.margin)
        // Update the existing position
        position.contracts = BigNumber(position.contracts).minus(contracts).toNumber();
        if(margin>position.margin){
            if(Math.abs(position.contracts)>Math.abs(contracts)){
                //instead of trying to calculate init/main. margin in between trade and mark prices, let's keep it simple and liquidation safer
                //and just not take from margin, mmkay
                excess = margin
                margin = 0
            }else{
                excess = BigNumber(margin).minus(position.margin).decimalPlaces(8).toNumber()
                margin = position.margin
            }
        }
        let prevMargin = position.margin
        position.margin = BigNumber(position.margin).minus(margin).decimalPlaces(8).toNumber();
        let marginChange = BigNumber(prevMargin).minus(position.margin)
        let avgDelta = 0
        if(first==false){
            vaultPosition.contracts = BigNumber(vaultPosition.contracts).plus(contracts).toNumber();
            vaultPosition.margin = BigNumber(position.margin).plus(margin).decimalPlaces(8).toNumber();
            let oldAvg = vaultPosition.avgPrice
            if(!oldAvg){oldAvg=0}
            vaultPosition.avgPrice = this.updatedAvgPrice(vaultPosition, amount, position.avgPrice, contractId, false)
            avgDelta = vaultPosition.avgPrice-oldAvg    
        }else if(first==true){
            vaultPosition.contracts = contracts
            vaultPosition.margin = margin
            vaultPosition.avgPrice = position.avgPrice
            avgDelta = vaultPosition.avgPrice   
        }
        
        // Save the updated position
        if(address==null){throw new Error()}
        this.margins.set(address, position);
        this.margins.set(synthId,vaultPosition)
        await this.recordMarginMapDelta(synthId, contractId, vaultPosition.contracts, contracts, margin, 0, avgDelta, 'mintMarginAndContractsToVault');
        await this.recordMarginMapDelta(propertyId, contractId, position.contracts, contracts*-1, -margin, 0, 0, 'moveMarginAndContractsForMint');
        await this.saveMarginMap(block);

        return {contracts, margin,excess};
    }

    async moveMarginAndContractsForRedeem(address, propertyId, contractId, amount, vault, notional, initMargin,mark,block) {
            const position = this.margins.get(address);
            const vaultPosition = this.margins.get(propertyId)
            if (!position) {
                throw new Error(`No position found for redemption with ${propertyId} collateral and contract ${contractId}`);
            }

            let excess = 0;
            let contracts = vault.contracts;
            let margin = vault.margin;
            let contractShort = BigNumber(amount).dividedBy(notional).toNumber();
            let longClosed = 0;
            let covered = 0;
            let shortsAdded = 0
            let transferAvg = false
            let modifyAvg = false
            if (position.contracts > 0 && contractShort < position.contracts) {
                longClosed = contractShort;
                covered = contractShort;
            } else if (position.contracts > 0 && contractShort === position.contracts) {
                longClosed = contractShort;
                covered = contractShort;
            } else if (position.contracts > 0 && contractShort > position.contracts) {
                longClosed = position.contracts;
                shortsAdded = BigNumber(contractShort).minus(longClosed).toNumber();
                covered = longClosed;
                //this is going to simply transpose the avg. price in the vault position to the user as it opens a short
                transferAvg = true
            } else if(position.contract<0){
                //this is going to modify the avg. price as it increases the short position
                modifyAvg = true
                shortsAdded = contractShort
            }

            if(shortsAdded>0){
                position.avgPrice = this.updatedAvgPrice(position, amount, vaultPosition.avgPrice, contractId, false)
            }
            // Adjust the contract and margin positions for redemption
            position.contracts = BigNumber(position.contracts).plus(contracts).toNumber();

            // Calculate pro-rata factor and margin to return
            let totalOutstanding = vault.outstanding;
            let proRataFactor = BigNumber(amount).dividedBy(totalOutstanding).decimalPlaces(8).toNumber();
            let marginToReturn = BigNumber(vault.margin).multipliedBy(proRataFactor).decimalPlaces(8).toNumber();
            let availToReturn = BigNumber(vault.available).multipliedBy(proRataFactor).decimalPlaces(8).toNumber()
            
            let returnMargin = BigNumber(contractShort).times(initMargin).decimalPlaces(8).toNumber()
            let returnAvail = BigNumber(marginToReturn).minus(returnMargin).decimalPlaces(8).toNumber()

            if (notCovered > 0) {
                returnAvail = marginToReturn - (marginToReturn * (notCovered / contractShort));
            }

            // Record any excess margin
            excess = BigNumber(margin).minus(marginToReturn).decimalPlaces(8).toNumber();

            // Adjust the margin position for redemption (add margin back to the position)
                position.margin = BigNumber(position.margin).plus(returnMargin).decimalPlaces(8).toNumber();
            if(!modifyAvg&&!transferAvg){
                position.contracts = BigNumber(position.contracts).minus(longClosed).toNumber();   
            }
            let oldAvg = position.avgPrice
            let avgDelta = 0
            if(!oldAvg){oldAvg=0}
            if(transferAvg){
                position.avgPrice=vaultPosition.avgPrice
                position.contracts=BigNumber(position.contracts).minus(longClosed).minus(shortsAdded).toNumber()
            }
            if(modifyAvg){
                position.avgPrice=this.updatedAvgPrice(position, amount, vaultPosition.avgPrice, contractId, false)
                position.contracts= BigNumber(position.contracts).minus(shortsAdded).toNumber()
            }
            let accountingPNL =0
            let reduction = 0
            if(longClosed>0){
                  accountingPNL = await this.realizePnl(address, longClosed, vaultPosition.avgPrice, position.avgPrice, true, notional, position, false,contractId);
                  console.log('calculating rPNL in redeem '+accountingPNL)
                  reduction = await this.reduceMargin(position, longClosed, accountingPNL, true, contractId, address, false,false,0);
                  //somehow adding logic to realize profits on the shorts on this address as they are inherited/covered
                  //going to remove this edge case in validity for now then return later
            }

            console.log('updating margin map in redeem '+address+' '+JSON.stringify(position))
            if(address==null){throw new Error()}
            this.margins.set(address, position);
            await this.recordMarginMapDelta(propertyId, contractId, vault.contracts, contractShort, -returnMargin, -accountingPNL, 0, 'redeemMarginAndContractsFromVault');
            await this.recordMarginMapDelta(address,contractId, position.contracts, contractShort,returnMargin, accountingPNL,0,'moveMarginAndContractsForRedeem')
            await this.saveMarginMap(block);

            return { contracts: contractShort, margin: marginToReturn, available: availToReturn, excess: excess, rPNL: accountingPNL, reduction:reduction };
        }
        
    calculateMarginRequirement(contracts, price, inverse) {
        
        // Ensure that the input values are BigNumber instances
        let bnContracts = new BigNumber(contracts);
        let bnPrice = new BigNumber(price);

        let notional

        // Calculate the notional value
         if (inverse === true) {
            // For inverse contracts, the notional value in denominator collateral is typically the number of contracts divided by the price
            notional = bnContracts.dividedBy(bnPrice);
        } else {
            // For regular contracts, the notional value is the number of contracts multiplied by the price
            notional = bnContracts.multipliedBy(bnPrice);
        }

        // Return 10% of the notional value as the margin requirement
        return notional.multipliedBy(0.1).decimalPlaces(8).toNumber();
    }

     /**
     * Checks whether the margin of a given position is below the maintenance margin.
     * If so, it could trigger liquidations or other necessary actions.
     * @param {string} address - The address of the position holder.
     * @param {string} contractId - The ID of the contract.
     */
    async checkMarginMaintainance(address, contractId,position){
        if(!position){
            position = this.margins.get(address);
        }

        if (!position) {
            console.error(`No position found for address ${address}`);
            return;
        }

        const ContractRegistry = require('./contractRegistry.js')
        // Calculate the maintenance margin, which is half of the initial margin
        let initialMargin = await ContractRegistry.getInitialMargin(contractId, position.avgPrice);
        let initialMarginBN = new BigNumber(initialMargin)
        let contractsBN = new BigNumber(Math.abs(position.contracts))
        let maintenanceMarginFactorBN = new BigNumber(0.5)
        let maintenanceMargin = contractsBN.times(initialMarginBN).times(maintenanceMarginFactorBN).decimalPlaces(8).toNumber();
        console.log('components '+initialMargin+' '+position.contracts+' '+contractId+' '+position.avgPrice)
        console.log('checking maint margin '+position.margin+' '+position.unrealizedPNL+' <? '+maintenanceMargin)
        if (position.margin < maintenanceMargin) {
            console.log(`Margin below maintenance level for address ${address}. Initiating liquidation process.`);
            // Trigger liquidation or other necessary actions here
            // Example: this.triggerLiquidation(address, contractId);
            return true
        } else {
            console.log(`Margin level is adequate for address ${address}.`);
            return false
        }
    }

    async reduceMargin(pos, contracts, initPerContract, contractId, address, side, feeDebit, fee,block) {
        if (!pos) return { netMargin: new BigNumber(0), mode: 'none' };

        let posMargin = new BigNumber(pos.margin);
        let feeBN = new BigNumber(fee || 0);
        let contractAmount = new BigNumber(contracts);
        let posContracts = new BigNumber(pos.contracts);

        // ✅ **Calculate Required Margin for Current Position**
        let requiredMargin = posContracts.abs().times(initPerContract);
        console.log('inputs to calc req margin '+initPerContract+' '+pos.contracts+' '+posContracts)
        console.log(`🔎 Position: ${posContracts}, Contracts: ${contracts}, Required Margin: ${requiredMargin}`);

        // 🚀 **Calculate Excess Margin**
        let excessMargin = posMargin.minus(requiredMargin);
        
        if (excessMargin.isNegative()) {
            console.log(`⚠️ No excess margin to return.`);
            return 0;
        }

        // 💸 **Deduct Fee If Needed**
        if (feeDebit) {
            excessMargin = excessMargin.minus(feeBN);
            posMargin = posMargin.minus(feeBN);
        }

        // 🚨 **Ensure Margin Never Goes Below Required**
        let reduction = BigNumber.max(excessMargin, 0);

        // 🛠 **Apply Reduction**
        posMargin = posMargin.minus(reduction);

        // ✅ **Update Position & Save**
        pos.margin = posMargin.decimalPlaces(8).toNumber();
        reduction = reduction.decimalPlaces(8).toNumber();

        console.log(`✅ Final Margin: ${pos.margin} (Reduced by ${reduction}), Required Margin: ${requiredMargin.toFixed(8)}`);

        this.margins.set(pos.address, pos);
        await this.recordMarginMapDelta(address, contractId, 0, 0, -reduction, 0, 0, 'marginReduction');
        await this.saveMarginMap(block);

        return reduction
    }

    async feeMarginReduce(address,pos, reduction,contractId,block){
             // Now you can use the minus method
        pos.margin = new BigNumber(pos.margin).minus(reduction).decimalPlaces(8)
        .toNumber(); // Update the margin for the existing or new position
        console.log('updating margin in fee'+pos.margin)           
        this.margins.set(pos.address, pos);
        await this.recordMarginMapDelta(address, contractId, 0, 0, -reduction,0,0,'marginFeeReduction')
        //console.log('returning from reduceMargin '+reduction + ' '+JSON.stringify(pos)+ 'contractAmount '+contractAmount)
        await this.saveMarginMap(block);
        return pos;
    }

    
    async realizePnl(address, contracts, price, avgPrice, isInverse, notionalValue, pos, isBuy,contractId,block){
        if (!pos) return new BigNumber(0);

        let pnl;
        console.log('inside realizedPNL ' + address + ' ' + contracts + ' trade price ' + price + ' avg. entry ' + avgPrice + ' is inverse ' + isInverse + ' notional ' + notionalValue + ' position' + JSON.stringify(pos));
        
        if(avgPrice==0||avgPrice==null||avgPrice==undefined||isNaN(avgPrice)){
            console.log('weird avg. price input for realizedPNL ' +avgPrice+' '+address+ ' '+price+' '+JSON.stringify(pos))
        }

        const priceBN = new BigNumber(price);
        const avgPriceBN = new BigNumber(avgPrice);
        const contractsBN = new BigNumber(contracts);
        const notionalValueBN = new BigNumber(notionalValue);

        if (isInverse) {
            let one = new BigNumber(1)
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
            pnl = one.dividedBy(avgPriceBN).minus(one.dividedBy(priceBN))
                .times(contractsBN)
                .times(notionalValueBN)
            //console.log('pnl ' + pnl.toNumber());
        } else {
            // For linear contracts: PnL = (exitPrice - entryPrice) * contracts * notional
            pnl = priceBN
                .minus(avgPriceBN)
                .times(contractsBN)
                .times(notionalValueBN);
            //console.log('pnl ' + pnl.toNumber());
        }

        // Adjust the sign based on the isBuy flag
        pnl = isBuy ? pnl.times(-1) : pnl;
        pnl = pnl.decimalPlaces(8).toNumber()
        const absRPNL = Math.abs(pnl)
        const sign = pos.unrealizedPNL>0 ? 1: -1
        const signBN = new BigNumber(sign)
        // Modify the position object
        const uPNLBig = new BigNumber(Math.abs(pos.unrealizedPNL))
        pos.unrealizedPNL = uPNLBig.minus(absRPNL).times(sign).decimalPlaces(8).toNumber();
        pos.realizedPNL = pnl
        console.log('inside realizePnl ' + pnl + ' price then avgPrice ' + avgPrice + ' contracts ' + contracts + ' notionalValue ' + notionalValue);
        await this.recordMarginMapDelta(address, contractId,0,0,0,pnl,0,'rPNL')
      
        return pos
    }

    async recordMarginMapDelta(address, contractId, total, contracts, margin, uPNL, avgEntry, mode,block,mark){
            const newUuid = uuidv4();
            const dbInstance = await db.getDatabase('marginMapDelta');
            const deltaKey = `${address}-${contractId}-${newUuid}`;if (typeof contracts === 'object' && contracts.toNumber) {
                contracts = contracts.toNumber();
            }
            const delta = { address, contract: contractId, totalPosition: total, position: contracts, margin: margin, uPNL: uPNL, avgEntry, mode, block: block, lastPrice:mark};
            const ContractRegistry = require('./contractRegistry.js')
            console.log('saving marginMap delta ' + JSON.stringify(delta));

            try {
                // Try to find an existing document based on the key
                const existingDocument = await dbInstance.findOneAsync({ _id: deltaKey });

                if (existingDocument) {
                    // If the document exists, update it
                    await dbInstance.updateAsync({ _id: deltaKey }, { $set: { data: delta } });
                } else {
                    // If the document doesn't exist, insert a new one
                    await dbInstance.insertAsync({ _id: deltaKey, data: delta });
                }

                ContractRegistry.setModFlag(true)

                return; // Return success or handle as needed
            } catch (error) {
                console.error('Error saving marginMap delta:', error);
                throw error; // Rethrow the error or handle as needed
            }
    }



    /*realizePnl(address, contracts, price, avgPrice, isInverse, notionalValue, pos) {
        //const pos = this.margins.get(address);

        if (!pos) return 0;

        let pnl;
        console.log('inside realizedPNL '+address + ' '+contracts + ' trade price ' +price + ' avg. entry '+avgPrice + ' is inverse '+ isInverse + ' notional '+notionalValue + ' position' +JSON.stringify(pos))
        if (isInverse) {
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
            pnl = (1 / avgPrice - 1 / price) * contracts * notionalValue;
            console.log('pnl '+pnl)
        } else {
            // For linear contracts: PnL = (exitPrice - entryPrice) * contracts * notional
            pnl = (price - avgPrice) * contracts * notionalValue;
            console.log('pnl '+(price - avgPrice), contracts, notionalValue, pnl)
        }

        //pos.margin -= Math.abs(pnl);
        //pos.unrealizedPl += pnl; //be sure to modify uPNL and scoop it out for this value...
        console.log('inside realizePnl '+price + ' price then avgPrice '+avgPrice +' contracts '+contracts + ' notionalValue '+notionalValue)
        return pnl;
    }*/

    async settlePNL(address, contracts, price, lastMark, contractId, currentBlockHeight,inverse) {
                const pos = this.margins.get(address);

                if (!pos) return 0;
                const ContractRegistry = require('./ContractRegistry.js')
                // Check if the contract is associated with an orac
                let pnl = 0
                if(!inverse){
                     // Calculate PnL based on settlement price
                console.log('inside settlePNL ' +lastMark+' '+price+' '+contracts)
                pnl = new BigNumber((price - lastMark) * contracts);
                console.log('calculated settle PNL '+pnl.toNumber()+' '+JSON.stringify(pnl))
                
                }else{
                      let one = new BigNumber(1)
            // For inverse contracts: PnL = (1/entryPrice - 1/exitPrice) * contracts * notional
                pnl = one.dividedBy(avgPriceBN).minus(one.dividedBy(priceBN))
                .times(contractsBN)
                .times(notionalValueBN)
                }
               
                if(contracts < 0){
                    pnl.negated(); // Invert the value if contracts is negative
                }
                // Update margin and unrealized PnL
                //pos.margin -= Math.abs(pnl);
                const uPNLBN = new BigNumber(pos.unrealizedPNL)
                pos.unrealizedPNL -= uPNLBN.minus(pnl).decimalPlaces(8).toNumber();
                this.margins.set(pos.address, pos)
                await this.recordMarginMapDelta(address, contractId, pos.contracts-contracts, contracts, 0, -pnl, 0, 'settlementPNL', currentBlockHeight)
      
                return pnl.decimalPlaces(8).toNumber();
        }

    async updateMargin(address, contractId, newMargin, block,position) {
        console.log(`Updating margin for ${address} on contract ${contractId} to ${newMargin}`);

        // Ensure the position exists
        if(!position){ position = this.margins.get(address)};

        if (!position) {
            console.warn(`No position found for ${address} on contract ${contractId}, initializing a new one.`);
            position = {
                contracts: 0,
                margin: 0,
                unrealizedPNL: 0,
                avgPrice: 0,
            };
        }
        const marginBN = new BigNumber(position.margin)
        const marginChange = new BigNumber(newMargin).plus(marginBN).decimalPlaces(8).toNumber();
        // Update the margin
        position.margin = marginChange

        // Save the updated position
        this.margins.set(position.address, position);

        // Record the change in margin map deltas
        await this.recordMarginMapDelta(address, contractId, position.contracts, 0, marginChange, 0, 0, 'updateMargin',block);

        // Persist changes to the database
        await this.saveMarginMap(block);
        return position
        console.log(`Margin successfully updated for ${address} on contract ${contractId}`);
    }

    async clear(position, address, pnlChange, avgPrice,contractId,block,markPrice,liqPrice,bankruptcyPrice) {
            if(position.unrealizedPNL==null||position.unrealizedPNL==undefined){
                position.unrealizedPNL=0
            }
            position.lastMark = markPrice
            const uPNLBN = new BigNumber(position.unrealizedPNL)
            position.unrealizedPNL=new BigNumber(pnlChange).plus(uPNLBN).decimalPlaces(8).toNumber()
            if(address==null){throw new Error()}
            //if(!position.liqPrice&&position.liqPrice!==null){position.liqPrice = liqPrice}
            //if(!position.bankruptcyPrice&&position.bankruptcyPrice!==null){position.bankruptcyPrice = bankruptcyPrice}
            this.margins.set(position.address, position)
            console.log('set clearing in position '+JSON.stringify(position))
            await this.saveMarginMap(block)
            await this.recordMarginMapDelta(address, contractId, position.contracts, 0, 0, pnlChange, avgPrice, 'markPrice',block,markPrice)
            return position
    }

    generateLiquidationOrder(position, contractId,total,block) {
                // Liquidate 50% of the position if below maintenance margin
                let sell 
                if(position.contracts>0){
                    sell = true
                }else if(position.contracts<0){
                    sell = false
                }else if(position.contracts==0){
                    return "err:0 contracts"
                }
                
                console.log(total+' '+position.contracts)
                    let liquidationSize = position.contracts
                
                if(!total){
                    liquidationSize = new BigNumber(position.contracts).dividedBy(2)
                    .decimalPlaces(0, BigNumber.ROUND_UP).toNumber();
                }
            
                let liquidationOrder={
                    address: position.address,
                    contractId: contractId,
                    amount: Math.abs(liquidationSize),
                    price: position.liqPrice,
                    sell: sell,
                    bankruptcyPrice: position.bankruptcyPrice,
                    isLiq: true,
                    blockTime: block
                }

                if(total||!position.liqPrice){
                    liquidationOrder.price = position.bankruptcyPrice
                }
                console.log('inside gen liq order '+total+' '+position.liqPrice+' '+position.bankruptcyPrice)
        return liquidationOrder;
    }

   async saveLiquidationOrders(contractId, position, order,reason,blockHeight,liquidationLoss,contractsDeleveraged, realizedLiquidation, delverageResults, infoBlob) {
        try {
            // Access the liquidations database
            const liquidationsDB = await db.getDatabase('liquidations');

            // Construct the key and value for storing the liquidation orders
            const key = `liquidationOrders-${contractId}-${blockHeight}`;
            const value = {
                _id: key, // Ensure uniqueness by setting the _id field
                order: order,
                position: position,
                reason: reason,
                blockHeight: blockHeight,
                liquidationLoss: liquidationLoss,
                contractsDeleveraged: contractsDeleveraged,
                realizedLiquidation: realizedLiquidation,
                deleverage: delverageResults,
                info: infoBlob
            };

            // Use updateAsync with upsert to insert or update the document
            await liquidationsDB.updateAsync(
                { _id: key }, // Query to find the document
                { $set: value }, // Data to set/update
                { upsert: true } // Enable upsert (insert if not found)
            );

            console.log(`Successfully saved liquidation order for contract ${contractId} at block height ${blockHeight}`);
        } catch (error) {
            console.error(`Error saving liquidation orders for contract ${contractId} at block height ${blockHeight}:`, error);
            throw error;
        }
    }

    async simpleDeleverage(contractId, unfilledContracts, sell, liqPrice, liquidatingAddress, isInverse,notional,block,markPrice,collateralId) {
      console.log(`\n🔸 [simpleDeleverage] contract=${contractId}, liqPrice=${liqPrice}, side=${sell}, unfilled=${unfilledContracts}`);
             const TallyMap= require('./tally.js')
      let remainingSize = new BigNumber(unfilledContracts);
      
      if(remainingSize.isNaN() || remainingSize.isNegative()){
        throw new Error(`🔥 Invalid unfilledContracts. Value: ${unfilledContracts}`);
      }

      // Blob for final report
      let deleveragingData = {
        liquidatingAddress: liquidatingAddress || null,
        contractId: contractId,
        attemptedDeleverage: remainingSize.toNumber(),
        totalDeleveraged: 0,
        counterparties: []
      };

      const allPositions = await this.getAllPositions(contractId,true);
      console.log(` Found ${allPositions.length} total positions in marginMap.`);

      // Filter out all longs vs. shorts
      let longs = allPositions.filter(p => p.contracts > 0 && p.address !== liquidatingAddress&& p.contracts !==0);
      let shorts = allPositions.filter(p => p.contracts < 0 && p.address !== liquidatingAddress && p.contracts !==0);

      // Sort each side by largest PNL first
      longs.sort((a, b) => new BigNumber(b.unrealizedPNL).minus(a.unrealizedPNL).toNumber());
      shorts.sort((a, b) => new BigNumber(b.unrealizedPNL).minus(a.unrealizedPNL).toNumber());

      console.log(`showing longs: ${JSON.stringify(longs)} \nshowing shorts: ${JSON.stringify(shorts)}`);

      // Select counterparties based on side
      let counterparties = sell ? shorts:longs;

      // Calculate contract differences for more even distribution
      for(let i = 0; i < counterparties.length; i++){
        let bigger = counterparties[i];
        let next = counterparties[i + 1] || { contracts: 0 };
        counterparties[i].difference = bigger.contracts - next.contracts;
      }

        console.log(`🔎 Checking counterparties...`);
        console.log(counterparties.length > 0 ? JSON.stringify(counterparties) : "❌ No counterparties found!");

      // Iterate through counterparties for deleveraging
      for (let pos of counterparties) {
        if(pos.contracts == 0){continue}
        let sizeBN = new BigNumber(pos.contracts);    
        let matchSize = Math.min(pos.difference, remainingSize.toNumber())

        // 🔹 If this is the last counterparty and there's still remaining size, force match
        if (pos === counterparties[counterparties.length - 1] && remainingSize.gt(0)) {
            matchSize = remainingSize.toNumber();
        }

        console.log(`• Matching: ${pos.address} (${sizeBN}) vs. ${liquidatingAddress} (${remainingSize}), remove ${matchSize}`);

        // Ensure matchSize is positive before proceeding
        if (matchSize > 0) {
          pos = await this.adjustDeleveraging(pos.address, contractId, matchSize, !sell,block,liqPrice,TallyMap);
            const matchBN = new BigNumber(matchSize)

        await this.clawbackOrClawForward(pos, markPrice, matchSize,notional,liqPrice,collateralId,block,TallyMap,sell,isInverse)

          pos = await this.realizePnl(
            pos.address,
            matchSize,
            liqPrice,
            pos.avgPrice,
            isInverse,
            notional,
            pos,
            !sell,
            contractId
          );

        console.log('post rPNL pos '+JSON.stringify(pos))
          // **Construct Trade Object**
        const trade = {
                contractId: contractId,
                amount: matchSize,
                price: liqPrice,
                markPrice: markPrice,
                counterpartyAddress: pos.address,
                liquidatingAddress: liquidatingAddress,
                block: block,
                realizedPnL: pos.realizedPNL,
                liquidation: true
            };

            // **Record Trade in Trade History**
            await this.recordContractTrade(trade, block,'','');

          deleveragingData.totalDeleveraged += matchSize;
          deleveragingData.counterparties.push(pos);

          remainingSize = remainingSize.minus(matchSize);
          console.log('delev data obj '+JSON.stringify(deleveragingData))
          if (remainingSize.isZero()) break;
        }

      if (remainingSize.gt(0)) {
        console.log(`⚠️ [simpleDeleverage] leftover unfilledContracts = ${remainingSize.toString()} -- no more matches possible!`);
      }
    }
        return deleveragingData;
}

    async clawbackOrClawForward(pos, markPrice, matchSize, notional, liqPrice, collateralId, block, TallyMap, sell, isInverse) {
      // **** New Clawback Logic ****
      // Compare the position's lastPrice (set previously during clearing) to markPrice.
      // If they are equal, calculate the difference between lastPrice and liqPrice.
      console.log('🔧' + pos.lastMark + ' ' + markPrice);
      
      if (pos.lastMark && new BigNumber(pos.lastMark).isEqualTo(markPrice)) {
        // For example: if sell is true, difference = lastPrice - liqPrice; else liqPrice - lastPrice.
        console.log('inside clawback ' + sell);
        let diff = sell 
          ? new BigNumber(pos.lastMark).minus(liqPrice)
          : new BigNumber(liqPrice).minus(pos.lastMark);
        console.log('diff ' + diff.decimalPlaces(8).toNumber() + ' ' + pos.lastMark + ' ' + liqPrice);
        console.log(Boolean(Math.abs(diff.toNumber()) > 0));
        
        if (Math.abs(diff.toNumber()) > 0) {
          let crawback = diff.times(matchSize).times(notional).decimalPlaces(8);
          if (isInverse) {
            crawback = diff
              .dividedBy(new BigNumber(pos.lastMark).times(new BigNumber(liqPrice)))
              .times(matchSize)
              .times(notional);
          }
          console.log(`🔧 Clawback adjustment for ${pos.address}: Difference = ${crawback.toFixed(8)}`);
        
        await TallyMap.updateBalance(
            pos.address,
            collateralId,
            crawback.toNumber(),      // Add to available (or subtract, depending on your accounting)
            0,
            0,
            0,
            'clawbackSettlement',
            block
          );
        }
      } else {
        // Profit adjustment logic: when lastMark != markPrice,
        // calculate profit as the difference between markPrice and lastMark.
        let profitDiff = sell 
          ? new BigNumber(pos.lastMark).minus(liqPrice/*markPrice*/)
          : new BigNumber(liqPrice/*markPrice*/).minus(pos.lastMark);
        console.log(`Profit difference for ${pos.address}: ${profitDiff.toFixed(8)}`);
        
        if (Math.abs(profitDiff.toNumber()) > 0) {
          let profit = profitDiff.times(matchSize).times(notional).decimalPlaces(8);
          if (isInverse) {
            profit = profit
              .dividedBy(new BigNumber(pos.lastMark).times(new BigNumber(markPrice)))
              .times(matchSize)
              .times(notional);
          }
          console.log(`🔧 Profit adjustment for ${pos.address}: Profit = ${profit.toFixed(8)}`);
          await TallyMap.updateBalance(
            pos.address,
            collateralId,
            profit.toNumber(), // add profit tokens to available balance
            0,
            0,
            0,
            'profitAdjustmentSettlement',
            block
          );
        }
      }
      return
    }

    // Adjust deleveraging position
    async adjustDeleveraging(address, contractId, size, sell, block, liqPrice,TallyMap) {
        console.log(`Adjusting position for ${address}: reducing ${size} contracts on contract ${contractId} for side ${sell}`);
        const ContractRegistry= require('./contractRegistry.js')
 
        let position = await this.getPositionForAddress(address, contractId);
        const initPerContract = await ContractRegistry.getInitialMargin(contractId,liqPrice)
        const collateral = await ContractRegistry.getCollateralId(contractId)    
        if (!position) return;
        const contractChange = sell ? -size : size
        console.log('⚠️ '+contractChange+' '+position.contracts)
        if(!contractChange||!position.contracts){
            console.log('issue in deleveraging '+contractChange+' '+position.contracts)
            throw new Error()
        } 

        const contractChangeBN = new BigNumber(contractChange)
        position.contracts = new BigNumber(position.contracts).plus(contractChangeBN).toNumber();
        let reduction = await this.reduceMargin(position, contractChange, initPerContract, contractId, address, sell, false, 0)
        console.log('reduction '+reduction)
        const hasSufficient = await TallyMap.hasSufficientMargin(address,collateral,reduction)
        console.log(JSON.stringify(hasSufficient))
        if(!hasSufficient.hasSufficient){
            reduction = new BigNumber(reduction).minus(hasSufficient.shortfall).decimalPlaces(8).toNumber()
        }
        if(reduction !==0){
             await TallyMap.updateBalance(address, collateral, reduction, 0, -reduction, 0, 'contractDelevMarginReturn',block)              
        }
        if (position.contracts === 0) {
            position.liqPrice = null;
            position.bankruptcyPrice = null;
        }

        console.log('⚠️ '+position.contracts)
        this.margins.set(position.address, position);
        this.recordMarginMapDelta(address,contractId, position.contracts,contractChangeBN, position.margin,position.uPNL,position.avgEntry,'Deleveraging',block)  
        await this.saveMarginMap(block);
        return position
    }

    async dynamicDeleverage(contractId, side, unfilledContracts, liqPrice) {
        console.log(`Starting dynamic deleveraging for contract ${contractId} at liquidation price ${liqPrice}`);

        let remainingSize = new BigNumber(unfilledContracts);

        // Load marginMap instance for the given contractId
        const marginMap = await MarginMap.getInstance(contractId);

        // Fetch all positions from marginMap
        const allPositions = await marginMap.getAllPositions();

        // Load contract details for collateral filtering
        const contractInfo = await ContractRegistry.getContractInfo(contractId);
        const collateralId = contractInfo.collateralPropertyId;
        const notionalValue = new BigNumber(contractInfo.notionalValue);

        let potentialCounterparties = [];

        for (let position of allPositions) {
            if (position.contracts === 0) continue; // Skip inactive positions

            // Ensure the position belongs to the same collateral pool
            if (position.collateralId !== collateralId) continue;

            // Fetch available and reserved balances from TallyMap
            const tally = await TallyMap.getTally(position.address, collateralId);
            const availableCollateral = new BigNumber(tally.available);
            const reservedCollateral = new BigNumber(tally.reserved);

            // Calculate position notional value at liquidation price
            const positionNotional = notionalValue.times(Math.abs(position.contracts)).times(liqPrice);

            // Compute net exposure by summing positions for this collateral across all contracts
            const totalExposure = await calculateNetExposure(position.address, collateralId);

            // Ensure the side is opposite (we need shorts to absorb long liquidations and vice versa)
            const isCounterparty = side ? position.contracts < 0 : position.contracts > 0;

            if (isCounterparty) {
                // Calculate leverage = (position notional) / (available + reserved collateral)
                const totalCollateral = availableCollateral.plus(reservedCollateral);
                const leverage = totalCollateral.isZero() ? new BigNumber(Infinity) : positionNotional.dividedBy(totalCollateral);

                potentialCounterparties.push({
                    address: position.address,
                    contracts: position.contracts,
                    leverage,
                    exposure: totalExposure
                });
            }
        }

        // Sort counterparties by highest leverage, then by naked exposure (descending order)
        potentialCounterparties.sort((a, b) => {
            if (!b.exposure && a.exposure) return 1; // Prefer naked positions
            if (!a.exposure && b.exposure) return -1;
            return b.leverage.minus(a.leverage).toNumber(); // Highest leverage first
        });

        // Match positions for deleveraging
        for (let counterparty of potentialCounterparties) {
            if (remainingSize.isZero()) break;

            let absorbAmount = new BigNumber(Math.abs(counterparty.contracts));
            let matchedAmount = BigNumber.min(remainingSize, absorbAmount);

            console.log(`Matching ${matchedAmount} contracts to ${counterparty.address}`);

            await executeDeleveraging(counterparty.address, contractId, matchedAmount, side, liqPrice);

            remainingSize = remainingSize.minus(matchedAmount);
        }

        if (!remainingSize.isZero()) {
            console.log(`WARNING: Unable to fully deleverage ${remainingSize.toString()} contracts`);
        }
        console.log(`Deleveraging complete.`);
    }

// Helper function to compute net exposure across all contract positions for an address
async calculateNetExposure(address, collateralId) {
    const allContracts = await ContractRegistry.getContractsForCollateral(collateralId);
    let netExposure = new BigNumber(0);

    for (let contract of allContracts) {
        const marginMap = await MarginMap.getInstance(contract.contractId);
        const position = await marginMap.getPositionForAddress(address, contract.contractId);
        if (position) {
            netExposure = netExposure.plus(position.contracts);
        }
    }
    return netExposure;
}

// Helper function to execute deleveraging trade
async executeDeleveraging(address, contractId, size, side, liqPrice,block) {
    console.log(`Executing deleveraging: ${address} ${size} contracts at ${liqPrice}`);
    
    const marginMap = await MarginMap.getInstance(contractId);
    let position = await marginMap.getPositionForAddress(address, contractId);

    if (!position) return;

    position.contracts = new BigNumber(position.contracts).plus(side ? size : -size).toNumber();

    if (position.contracts === 0) {
        position.liqPrice = null;
        position.bankruptcyPrice = null;
    }

    marginMap.margins.set(position.address, position);
    await marginMap.saveMarginMap(block);
}

async fetchLiquidationVolume(blockHeight, contractId, mark) {
        const liquidationsDB = await db.getDatabase('liquidations');
        // Fetch liquidations from the database for the given contract and blockHeight
        let liquidations = []

        try {
                // Construct the key based on the provided structure
                const key = `liquidationOrders-${contractId}-${blockHeight}`;
                
                // Find the document with the constructed key
                liquidations = await liquidationsDB.findOneAsync({ _id: key });
            } catch (error) {
                console.error('Error fetching liquidations:', error);
            }
        // Initialize BigNumber instances
        let liquidatedContracts = new BigNumber(0);
        let filledLiqContracts = new BigNumber(0);
        let bankruptcyVWAPPreFill = new BigNumber(0);
        let filledVWAP = new BigNumber(0);
        let avgBankrupcyPrice = new BigNumber(0);
        let liquidationOrders = new BigNumber(0);
        let sells = new BigNumber(0);
        let buys = new BigNumber(0);

        // Calculate values using BigNumber
        if (liquidations && liquidations.length > 0) {
            liquidations.forEach(liquidation => {
                liquidationOrders = liquidationOrders.plus(1);
                liquidatedContracts = liquidatedContracts.plus(liquidation.contractCount);
                bankruptcyVWAPPreFill = bankruptcyVWAPPreFill.plus(new BigNumber(liquidation.size).times(new BigNumber(liquidation.bankruptcyPrice)));
                avgBankrupcyPrice = avgBankrupcyPrice.plus(new BigNumber(liquidation.bankruptcyPrice));
                if (liquidation.side == false) {
                    sells = sells.plus(0);
                } else if (liquidation.side == true) {
                    buys = buys.plus(0);
                }
            });
        }else{
            console.log("No liquidations found for the given criteria.");
        }

        bankruptcyVWAPPreFill = bankruptcyVWAPPreFill.dividedBy(liquidatedContracts);
        avgBankrupcyPrice = avgBankrupcyPrice.dividedBy(liquidationOrders);

        const tradeHistoryDB = await db.getDatabase('tradeHistory');
        const tradeKey = `liquidationOrders-${contractId}-${blockHeight}`;
        // Fetch trade history for the given blockHeight and contractId
        const trades = await tradeHistoryDB.findAsync();

        // Count the number of liquidation orders in the trade history
        let liquidationTradeMatches = new BigNumber(0);
        trades.forEach(trade => {
            if (trade.trade.isLiq === true&&trade.blockHeight==blockHeight) {
                liquidationTradeMatches = liquidationTradeMatches.plus(1);
                filledLiqContracts = filledLiqContracts.plus(trade.trade.amount);
                filledVWAP = filledVWAP.plus(trade.trade.tradePrice);
            }
        });
        filledVWAP = filledVWAP.dividedBy(filledLiqContracts);

        // Calculate the unfilled liquidation order contract count
        const unfilledLiquidationContracts = liquidatedContracts.minus(filledLiqContracts);
        const lossDelta = bankruptcyVWAPPreFill.minus(filledVWAP);

        return {
            liqTotal: liquidatedContracts.toNumber(),
            liqOrders: liquidationOrders.toNumber(),
            unfilled: unfilledLiquidationContracts.toNumber(),
            bankruptcyVWAPPreFill: bankruptcyVWAPPreFill.toNumber(),
            filledVWAP: filledVWAP.toNumber(),
            lossDelta: lossDelta.toNumber()
        };
    }


    needsLiquidation(contract) {
        const maintenanceMarginFactor = 0.05; // Maintenance margin is 5% of the notional value

        for (const [address, position] of Object.entries(this.margins[contract.id])) {
            const notionalValue = position.contracts * contract.marketPrice;
            const maintenanceMargin = notionalValue * maintenanceMarginFactor;

            if (position.margin < maintenanceMargin) {
                return true; // Needs liquidation
            }
        }
        return false; // No positions require liquidation
    }


     // Get the position for a specific address
    async getPositionForAddress(address, contractId) {

            const map = await MarginMap.loadMarginMap(contractId);
            let position = map.margins.get(address);
        // If still not found, return a default position
        if (!position) {
            return {
                contracts: 0,
                margin: 0,
                unrealizedPl: 0,
                // Add other relevant fields if necessary
            };
        }

        return position;
    }

    async getMarketPrice(contract) {
        let marketPrice;

        if (ContractsRegistry.isOracleContract(contract.id)) {
            // Fetch the 3-block TWAP for oracle-based contracts
            marketPrice = await Oracles.getTwap(contract.id, 3); // Assuming the getTwap method accepts block count as an argument
        } else if (ContractsRegistry.isNativeContract(contract.id)) {
            // Fetch VWAP data for native contracts
            const contractInfo = ContractsRegistry.getContractInfo(contract.id);
            if (contractInfo && contractInfo.indexPair) {
                const [propertyId1, propertyId2] = contractInfo.indexPair;
                marketPrice = await VolumeIndex.getVwapData(propertyId1, propertyId2,3);
            }
        } else {
            throw new Error(`Unknown contract type for contract ID: ${contract.id}`);
        }

        return marketPrice;
    }

    async recordContractTrade(trade, blockHeight, sellerTx, buyerTx) {
            const tradeRecordKey = `contract-${trade.contractId}`;
            const tradeRecord = {
                key: tradeRecordKey,
                type: 'contract',
                trade,
                blockHeight,
                sellerTx,
                buyerTx
            };
            //console.log('saving contract trade ' +JSON.stringify(trade))
            await this.saveTrade(tradeRecord);
        }

        async saveTrade(tradeRecord) {
            const tradeDB =await db.getDatabase('tradeHistory');

            const uuid = uuidv4();

            // Use the key provided in the trade record for storage
            const tradeId = `${tradeRecord.key}-${uuid}-${tradeRecord.blockHeight}`;

            // Construct the document to be saved
            const tradeDoc = {
                _id: tradeId,
                ...tradeRecord
            };

            // Save or update the trade record in the database
            try {
                await tradeDB.updateAsync(
                    { _id: tradeId },
                    tradeDoc,
                    { upsert: true }
                );
                console.log(`Trade record saved successfully: ${tradeId}`);
            } catch (error) {
                //console.error(`Error saving trade record: ${tradeId}`, error);
                throw error; // Rethrow the error for handling upstream
            }
        }

}

module.exports = MarginMap