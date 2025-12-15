const TallyMap = require('./tally.js')
const ContractRegistry = require('./contractRegistry.js');
const db = require('./db.js')
const BigNumber = require('bignumber.js');
// Access the database where oracle data is stored
const Options = require('./options.js');
const MarginMap = require('./marginMap.js')
const Insurance = require('./insurance.js')
const Orderbooks = require('./orderbook.js')
const Channels = require('./channels.js')
const PropertyManager = require('./property.js')
const VolumeIndex = require('./volumeIndex.js')
const Oracles = require('./oracle.js')
const PnlIou = require('./iou.js')
const TradeHistory = require('./tradeHistoryManager.js')

const _positionCache = new Map(); 

class Clearing {
    // ... other methods ...
    constructor() {
        // Access the singleton instance of TallyMap
        //this.tallyMap = TallyMap.getSingletonInstance();
        this.balanceChanges = []; // Initialize an array to track balance changes
    }

    static blockTrades = new Map();        // Pre-clearing trades: `${contractId}:${address}` → [{delta, opened}]
    static deleverageTrades = new Map();   // Deleverage events: `${contractId}:${address}` → [{matchSize, fromOld, fromNew, ...}]
    static liquidationRecords = new Map(); // Liquidation records: `${contractId}:${address}` → {pool, contracts, ...}
    // ---------------------------------------------------------------------------
    // PRICE CACHE
    // ---------------------------------------------------------------------------
    // oracleId -> { price, blockHeight }
    static latestOracleMarkById = new Map();
    // native contractId -> { price, blockHeight }
    static latestNativeMarkById = new Map();
    // contractId -> { price: number, blockHeight: number }

    // =========================================
    // TRADE TRACKING
    // =========================================
       // clearing.js
    static _ensureBlockTradeEntry(key) {
      if (!this.blockTrades.has(key)) {
        this.blockTrades.set(key, { openedSoFar: 0, trades: [] });
      }
      const entry = this.blockTrades.get(key);

      // add pools lazily (only used by "new" path)
      if (!entry.pools) {
        const BigNumber = require('bignumber.js');
        entry.pools = {
          long:  { qty: new BigNumber(0), cost: new BigNumber(0) },
          short: { qty: new BigNumber(0), cost: new BigNumber(0) },
        };
      }

      return entry;
    }

    /**
     * recordTrade(contractId, address, opened, closed, price, sideHint?)
     *
     * - Legacy mode (sideHint == null): behaves exactly like old openedSoFar stack.
     * - Pool mode (sideHint provided): tracks same-block opens in long/short pools and
     *   computes consumedFromOpened + consumedAvgPrice for same-block closes.
     *
     * sideHint: true/"buy" => incoming BUY leg for this address
     *           false/"sell" => incoming SELL leg for this address
     */
    static recordTrade(contractId, address, opened, closed, price, sideHint = null) {
      const key = `${contractId}:${address}`;
      const entry = this._ensureBlockTradeEntry(key);

      // ------------------------------------------------------------
      // LEGACY PATH (unchanged behavior)
      // ------------------------------------------------------------
      if (sideHint === null || sideHint === undefined) {
        if (opened > 0) {
          entry.openedSoFar += opened;
        }

        let consumedFromOpened = 0;
        if (closed > 0) {
          consumedFromOpened = Math.min(entry.openedSoFar, closed);
          entry.openedSoFar -= consumedFromOpened;
        }

        const tradeObj = {
          opened,
          closed,
          consumedFromOpened,
          price,
          openedBefore: entry.openedSoFar + consumedFromOpened
        };

        entry.trades.push(tradeObj);
        return tradeObj;
      }

      // ------------------------------------------------------------
      // POOL PATH (same-block avg-cost per side)
      // ------------------------------------------------------------
      const BigNumber = require('bignumber.js');

      const isBuyer =
        sideHint === true ||
        sideHint === "buy" ||
        sideHint === "BUY";

      const px = new BigNumber(price || 0);
      const openedAbs = new BigNumber(Math.abs(opened || 0));
      const closedAbs = new BigNumber(Math.abs(closed || 0));

      const openPool  = isBuyer ? entry.pools.long  : entry.pools.short;
      const closePool = isBuyer ? entry.pools.short : entry.pools.long;

      const openedBefore = openPool.qty.toNumber();

      // add opens to incoming side
      if (openedAbs.gt(0)) {
        openPool.qty  = openPool.qty.plus(openedAbs);
        openPool.cost = openPool.cost.plus(openedAbs.multipliedBy(px));
      }

      // consume closes from opposite side pool (same-block closes)
      let consumedFromOpened = new BigNumber(0);
      let consumedAvgPrice = null;

      if (closedAbs.gt(0) && closePool.qty.gt(0)) {
        consumedFromOpened = BigNumber.min(closedAbs, closePool.qty);

        const avgEntry = closePool.cost.dividedBy(closePool.qty);
        consumedAvgPrice = avgEntry.toNumber();

        const consumedCost = avgEntry.multipliedBy(consumedFromOpened);
        closePool.qty  = closePool.qty.minus(consumedFromOpened);
        closePool.cost = closePool.cost.minus(consumedCost);
      }

      const tradeObj = {
        opened: openedAbs.toNumber(),                 // keep legacy shape
        closed: closedAbs.toNumber(),
        consumedFromOpened: consumedFromOpened.toNumber(),
        price: px.toNumber(),
        openedBefore,
        // new field (optional, harmless): exact avg entry of same-block opens consumed
        consumedAvgPrice
      };

      entry.trades.push(tradeObj);

      // keep openedSoFar meaningful-ish for any legacy readers (optional, but safe)
      entry.openedSoFar =
        entry.pools.long.qty.plus(entry.pools.short.qty).toNumber();

      return tradeObj;
    }


    static _normalizeTrades(entry) {
        if (!entry) return [];
        if (Array.isArray(entry)) return entry;            // old format
        if (Array.isArray(entry.trades)) return entry.trades; // new format
        return [];
    }

    static _normalizeEntry(entry) {
        if (!entry) return { openedSoFar: 0, trades: [] };
        if (Array.isArray(entry)) {
            // Construct a pseudo-entry for backwards compat
            return { openedSoFar: 0, trades: entry };
        }
        return entry; // already in new format
    }

    static getOpenedBeforeThisTrade(contractId, address, currentTradeIndexOrObj) {
        const key = `${contractId}:${address}`;
        const entry = this.blockTrades.get(key);
        const trades = this._normalizeTrades(entry);

        let opened = 0;

        // Case 1: index
        if (typeof currentTradeIndexOrObj === "number") {
            const stop = Math.max(0, Math.min(currentTradeIndexOrObj, trades.length));
            for (let i = 0; i < stop; i++) {
                const t = trades[i];
                opened += t?.opened || 0;
            }
            return opened;
        }

        // Case 2: object reference
        for (const t of trades) {
            if (t === currentTradeIndexOrObj) break;
            opened += t?.opened || 0;
        }

        return opened;
    }

    static getTrades(contractId, address) {
        const key = `${contractId}:${address}`;
        const entry = this.blockTrades.get(key);
        return this._normalizeTrades(entry);
    }

    static countTrades(contractId, address) {
        return this.getTrades(contractId, address).length;
    }

    static hadMultipleTrades(contractId, address) {
        return this.countTrades(contractId, address) > 1;
    }

    static hadAnyTrade(contractId, address) {
        return this.countTrades(contractId, address) > 0;
    }

    static applyMatchToOpenStats(openedByAddress, openedCostByAddress, match) {
      const BigNumber = require('bignumber.js');

      const buyer = match.buyerAddress || match?.buyOrder?.buyerAddress;
      const seller = match.sellerAddress || match?.sellOrder?.sellerAddress;
      if (!buyer || !seller) return;

      // ignore self-trades for opened stats
      if (buyer === seller) return;

      const amount = new BigNumber(match.amount || match.contracts || match?.buyOrder?.amount || 0);
      const price  = new BigNumber(match.tradePrice || match.price || match?.buyOrder?.price || match?.sellOrder?.price || 0);

      const buyerClose  = new BigNumber(match.buyerClose || 0);
      const sellerClose = new BigNumber(match.sellerClose || 0);

      // opened component is what *increased exposure* for that side on that fill
      const buyerOpenedAbs  = BigNumber.maximum(amount.minus(buyerClose), 0);
      const sellerOpenedAbs = BigNumber.maximum(amount.minus(sellerClose), 0);

      // buyer opens are +, seller opens are -
      if (buyerOpenedAbs.gt(0)) {
        const prev = new BigNumber(openedByAddress.get(buyer) || 0);
        openedByAddress.set(buyer, prev.plus(buyerOpenedAbs).toNumber());

        const prevCost = new BigNumber(openedCostByAddress.get(buyer) || 0);
        openedCostByAddress.set(buyer, prevCost.plus(buyerOpenedAbs.times(price)).toNumber());
      }

      if (sellerOpenedAbs.gt(0)) {
        const prev = new BigNumber(openedByAddress.get(seller) || 0);
        openedByAddress.set(seller, prev.minus(sellerOpenedAbs).toNumber());

        const prevCost = new BigNumber(openedCostByAddress.get(seller) || 0);
        openedCostByAddress.set(seller, prevCost.plus(sellerOpenedAbs.times(price)).toNumber());
      }
    }



    // =========================================
    // DELEVERAGE TRACKING (RAM only, atomic)
    // =========================================
    static recordDeleverageTrade(contractId, address, details) {
        const key = `${contractId}:${address}`;
        if (!this.deleverageTrades.has(key)) {
            this.deleverageTrades.set(key, []);
        }
        this.deleverageTrades.get(key).push(details);
    }

    static getDeleveragedThisBlock(contractId, address) {
        const key = `${contractId}:${address}`;
        const arr = this.deleverageTrades.get(key);
        if (!arr) return 0;
        return arr.reduce((sum, t) => sum + (t.matchSize || 0), 0);
    }

    static getDeleverageTradesThisBlock(contractId, address) {
        return this.deleverageTrades.get(`${contractId}:${address}`) || [];
    }

    // =========================================
    // LIQUIDATION TRACKING (RAM only)
    // =========================================
    static recordLiquidation(contractId, address, details) {
        this.liquidationRecords.set(`${contractId}:${address}`, details);
    }

    static getLiquidation(contractId, address) {
        return this.liquidationRecords.get(`${contractId}:${address}`);
    }

    // =========================================
    // VINTAGE BREAKDOWN - combines trade + deleverage data
    // =========================================
    static getVintageBreakdown(contractId, address, currentContracts) {
        const openedViaTrade = this.getOpenedBeforeThisTrade(contractId, address) || 0;
        const closedViaDelev = this.getDeleveragedThisBlock(contractId, address) || 0;
        
        const totalSize = Math.abs(currentContracts);
        const newFromTrades = Math.abs(openedViaTrade);
        
        // Account for new contracts already deleveraged
        const effectiveNew = Math.max(0, newFromTrades - closedViaDelev);
        const effectiveOld = Math.max(0, totalSize - effectiveNew);
        
        return {
            oldContracts: effectiveOld,
            newContracts: effectiveNew,
            totalContracts: totalSize,
            openedViaTrade,
            closedViaDelev
        };
    }

    // =========================================
    // RESET - clears all block-scoped tracking
    // =========================================
    static resetBlockTracking() {
        this.blockTrades.clear();
        this.deleverageTrades.clear();
        this.liquidationRecords.clear();
    }

    static resetBlockTrades() {
        this.resetBlockTracking();
    }

    static initPositionCache(contractId, blockHeight, positions) {
        const key = `${contractId}:${blockHeight}`;
        // Deep clone so nobody mutates marginMap’s internal structures
        const cloned = JSON.parse(JSON.stringify(positions));
        _positionCache.set(key, { positions: cloned });
        return key;
    }

    static getPositionsFromCache(ctxKey) {
        const ctx = _positionCache.get(ctxKey);
        if (!ctx) throw new Error(`No clearing context for ${ctxKey}`);
        return ctx.positions;
    }

    static updatePositionInCache(ctxKey, address, patchFn) {
        const ctx = _positionCache.get(ctxKey);
        if (!ctx) throw new Error(`No clearing context for ${ctxKey}`);
        const positions = ctx.positions;

        const idx = positions.findIndex(p => p.address === address);
        if (idx === -1) {
          throw new Error(`Position for ${address} not found in cache`);
        }

        const updated = patchFn(positions[idx]);
        positions[idx] = updated;
    }

    static flushPositionCache(ctxKey) {
        const ctx = _positionCache.get(ctxKey);
        if (!ctx) throw new Error(`No clearing context for ${ctxKey}`);
        _positionCache.delete(ctxKey);
        return ctx.positions;
    }

    static async recordClearingRun(blockHeight, isRealtime) {
    try {
        const base = await db.getDatabase('clearing');
        const entry = {
            _id: `run-${blockHeight}-${isRealtime ? 'rt' : 'sync'}`,
            blockHeight,
            isRealtime,
            timestamp: Date.now(),
        };
        await base.insertAsync(entry);
        console.log(`Clearing run recorded: block ${blockHeight} (realtime=${isRealtime})`);
    } catch (error) {
        console.error('Error recording clearing run:', error);
        //throw error;
    }
}


    static async clearingFunction(blockHeight,realtime) {
        //console.log(`Starting clearing operations for block ${blockHeight}`);

       //Clearing.recordClearingRun(blockHeight,realtime)
        // 1. Fee Cache Buy
        //await Clearing.feeCacheBuy(blockHeight);

        // 2. Set channels as closed if needed
        await Channels.removeEmptyChannels(blockHeight);

        // 3. Ensure correct margins, init margin and liq prices for new conditions
        //await Clearing.updateAllPositions(blockHeight)
        // 4. Funding Settlement
        await Clearing.applyFundingRates(blockHeight)
        // 5. Settle trades at block level
        await Clearing.makeSettlement(blockHeight);
         // Ensure Net Contracts = 0
         const ContractRegistry = require('./contractRegistry.js')
    if(ContractRegistry.modFlag){
        const netContracts = await Clearing.verifyNetContracts();
        if (netContracts !== 0) {
            throw new Error(`❌ Clearing failed on block ${blockHeight}: Net contracts imbalance detected: ${netContracts}`);
        }
        ContractRegistry.setModFlag(false) //reset the flag to be set true next time there's a marginMap delta
    }

        const TallyMap = require('./tally.js')    
    if(TallyMap.modFlag){
       await Clearing.getTotalTokenBalances(blockHeight)
        TallyMap.setModFlag(false) //reset the flag to be set true next time there's a marginMap delta
    }

    //console.log("✅ Net contracts check passed: System is balanced.");

        //console.log(`Clearing operations completed for block ${blockHeight}`);
        return
    }

    static async verifyNetContracts() {
        const ContractRegistry = require('./contractRegistry.js')
        const allContracts = await ContractRegistry.getAllContracts();
        let netContracts = new BigNumber(0);

        for (const contract of allContracts) {
            const marginMap = await MarginMap.loadMarginMap(contract.id);
            const positions = await marginMap.getAllPositions();
            
            for (const pos of positions) {
                netContracts = netContracts.plus(pos.contracts);
            }
        }
        console.log('net contracts '+netContracts.toNumber())

        return netContracts.toNumber();
    }

    static async getTotalTokenBalances(block) {
        const TallyMap = require('./tally.js');
        const InsuranceFund = require('./insurance.js');
        const PropertyList = require('./property.js');
        const Vaults = require('./vaults.js')
        // Load property list
        const propertyIndex = await PropertyList.getPropertyIndex();
        //console.log('📌 Parsed property index:', propertyIndex);

        for (const propertyData of propertyIndex) {
            const propertyId = propertyData.id;
            let propertyTotal = new BigNumber(0);

            // ✅ 1️⃣ Fetch total balance from TallyMap
            const tallyTotal = await TallyMap.getTotalForProperty(propertyId);
            console.log(`📌 Tally total for ${propertyId}: ${tallyTotal}`);
            propertyTotal = propertyTotal.plus(tallyTotal);

            // ✅ 2️⃣ Add feeCache balance
            const feeCacheBalance = await TallyMap.loadFeeCacheForProperty(propertyId);
            console.log('fee cache balance '+feeCacheBalance)
            propertyTotal = propertyTotal.plus(feeCacheBalance);

            // ✅ 3️⃣ Properly Aggregate Insurance Fund Balances
            const insuranceBalance = await InsuranceFund.getTotalBalanceForProperty(propertyId);
            propertyTotal = propertyTotal.plus(insuranceBalance);
            console.log(`📌 Insurance balance for ${propertyId}: ${insuranceBalance}`);
            if(typeof propertyId=="number"){
                const vaultTotal = await Vaults.getTotalBalanceForProperty(propertyId)
                console.log('vaultTotal '+vaultTotal)
                propertyTotal = propertyTotal.plus(vaultTotal)
            }

            // ✅ 4️⃣ Include vesting from `TLVEST` → `TL` & `TLI` → `TLIVEST`
            if (propertyId === 1) {
                const vestingTLVEST = await TallyMap.getTotalTally(2); // Get vesting of TLVEST
                propertyTotal = propertyTotal.plus(vestingTLVEST.vesting);
                console.log(`📌 Added vesting from TLVEST to TL: ${vestingTLVEST.vesting}`);
            }
            if (propertyId === 4) {
                const vestingTLI = await TallyMap.getTotalTally(3); // Get vesting of TLI
                propertyTotal = propertyTotal.plus(vestingTLI.vesting);
                //console.log(`📌 Added vesting from TLI to TLIVEST: ${vestingTLI.vesting}`);
            }
            const propertyInIou =await PnlIou.getTotalForProperty(propertyId)
            console.log('adding Iou '+propertyTotal.toNumber()+' Iou'+propertyInIou)
            propertyTotal= propertyTotal.plus(propertyInIou)

            // ✅ 5️⃣ Compare Against Expected Circulating Supply
            let expectedCirculation = new BigNumber(propertyData.totalInCirculation);
            if(typeof propertyId =='string'&& propertyId.startsWith("s-")){

                expectedCirculation = await Vaults.getTotalOutstandingForProperty(propertyId);
                console.log('vault diversion ')
            }
            console.log('total '+propertyTotal.toNumber()+' expected '+expectedCirculation.toNumber())
            if(!propertyTotal.eq(expectedCirculation)){
                if(!(propertyId === 3 || propertyId === 4 || propertyData.type === 2)){
                    const difference = propertyTotal.minus(expectedCirculation).decimalPlaces(8).toNumber()
                    if(difference>0.00000001||difference<-0.00000001){
                         throw new Error(`❌ Supply mismatch for Property ${propertyId}, diff ${difference}: Expected ${expectedCirculation.toFixed()}, Found ${propertyTotal.toFixed()}`+' on block '+block);
                    }else if(difference==-0.00000001){
                        TallyMap.recordTallyMapDelta('system',block,propertyId,difference,0,0,0,0,0,'salvageDust','')
                        const fund = await InsuranceFund.getInstance(propertyId,false)
                        await fund.deposit(1,0.00000001,block)
                    }
                } else {
                    const difference = propertyTotal.minus(expectedCirculation).decimalPlaces(8).toNumber()
                    console.warn(`⚠️ Property ${propertyId} supply changed, diff ${difference} (Expected: ${expectedCirculation.toFixed()}, Found: ${propertyTotal.toFixed()}), but it's allowed.`);
                }
            }
        }

        return
    }

    static async applyFundingRates(block) {
        if (block % 24 !== 0) return; // Only run every 24 blocks (~1 hour)
        
        //console.log(`⏳ Applying funding rates at block ${block}`);

        const ContractRegistry = require('./contractRegistry.js');
        const contracts = await ContractRegistry.getAllPerpContracts(); // Get all perpetual contracts

        for (const contractId of contracts) {
            //console.log(`📜 Processing funding for contract ${contractId}`);

            // **Step 1: Calculate Funding Rate**
            const fundingRate = await Clearing.calculateFundingRate(contractId, block);
            if (fundingRate === 0) {
                //console.log(`⚠️ Skipping contract ${contractId}, funding rate is 0`);
                continue;
            }

            console.log(`💰 [Funding Rate] Contract=${contractId}, Rate=${fundingRate} bps`);

            // **Step 2: Apply Funding to Positions**
            await Clearing.applyFundingToPositions(contractId, fundingRate, block);
            await Clearing.saveFundingEvent(contractId, fundingRate, block)
        }
        //console.log("✅ Funding rate application complete");
    }

    static async calculateFundingRate(contractId, blockHeight) {
        try {
            const ContractRegistry = require('./contractRegistry.js');
            const VolumeIndex = require('./volumeIndex.js');
            const contractInfo = await ContractRegistry.getContractInfo(contractId);
            if (!contractInfo) {
                console.warn(`⚠️ No contract found for ID ${contractId}`);
                return 0;
            }

            let vwap;

            if (contractInfo.native) {
                // Native contract → Fetch VWAP from `VolumeIndex`
                vwap = await VolumeIndex.getVWAP(
                    contractInfo.notionalPropertyId,
                    contractInfo.collateralPropertyId,
                    blockHeight,
                    192 // Last 8 hours (192 blocks)
                );
            } else {
                // Oracle-based contract → Fetch VWAP from `OracleList`
                vwap = await Oracles.getTWAP(contractInfo.underlyingOracleId, blockHeight, 192);
            }

            if (!vwap) {
                //console.warn(`⚠️ No VWAP data found for contract ${contractId} in last 8 hours.`);
                return 0;
            }

            // Get latest index price (Oracle or VolumeIndex)
            const indexPrice = await Clearing.getIndexPrice(contractId, blockHeight);
            if (!indexPrice) {
                //console.warn(`⚠️ No index price available for contract ${contractId}.`);
                return 0;
            }

            // Compute basis points difference
            const priceDiff = new BigNumber(indexPrice).minus(vwap);
            const basisPoints = priceDiff.dividedBy(vwap).times(10000).decimalPlaces(2).toNumber(); // Convert to bps

            console.log(`📊 [Funding Rate Calc] VWAP: ${vwap}, Index Price: ${indexPrice}, Diff: ${priceDiff.toFixed(2)} (${basisPoints} bps)`);

            // Apply clamp function
            const clampedBps = this.clampFundingRate(basisPoints);

            // Compute per-hour funding rate (divided by 8)
            let fundingRate = new BigNumber(clampedBps).dividedBy(8).decimalPlaces(4).toNumber();

            // Cap max rate at ±100 bps per 8 hours (12.5 bps per hour)
            if (Math.abs(fundingRate) > 12.5) {
                fundingRate = Math.sign(fundingRate) * 12.5;
            }

            console.log(`📈 Final Funding Rate: ${fundingRate} bps per hour`);
            return fundingRate;
        } catch (error) {
            console.error(`❌ Error calculating funding rate for contract ${contractId}:`, error);
            return 0;
        }
    }


    static async getIndexPrice(contractId, blockHeight) {
        // Load contract info (get from memory, or from DB)
        const contractInfo = await ContractRegistry.getContractInfo(contractId); // or your method

        // Check for oracle-based contract
        if (contractInfo.underlyingOracleId !== undefined && contractInfo.underlyingOracleId !== null && !isNaN(contractInfo.underlyingOracleId)) {
            // Use the oracle price
            return await Oracle.getOraclePrice(contractInfo.underlyingOracleId, blockHeight);
        } else {
            // Use volume index price (for most synthetic/inverse contracts)
            // If your contract uses notionalPropertyId and collateralPropertyId, use those!
            return await VolumeIndex.getIndexForBlock(contractId, blockHeight);
        }
    }

    // **Clamp function for funding rate**
    static clampFundingRate(basisPoints) {
        if (Math.abs(basisPoints) < 5) return 0; // Ignore small deviations
        return Math.sign(basisPoints) * (Math.abs(basisPoints) - 5); // Reduce deviation >5bps by 5
    }


    static async applyFundingToPositions(contractId, fundingRate, block) {
        const margins = await MarginMap.getInstance(contractId);
        const openPositions = await margins.getAllPositions(contractId);
        const notionalPerContract = await ContractRegistry.getNotionalValue(contractId); // Fetch notional value

        if (!openPositions.length) {
            //console.log(`⚠️ No positions found for contract ${contractId}`);
            return;
        }

        // Separate longs and shorts
        let longs = openPositions.filter(pos => pos.contracts > 0);
        let shorts = openPositions.filter(pos => pos.contracts < 0);

        let longFunding = new BigNumber(0);
        let shortFunding = new BigNumber(0);

        // **Calculate total funding owed by each side**
        for (let pos of openPositions) {
            const contractsBN = new BigNumber(Math.abs(pos.contracts));
            const fundingAmount = contractsBN.times(notionalPerContract).times(fundingRate / 10000).decimalPlaces(8);

            if (fundingRate > 0 && pos.contracts > 0) {
                longFunding = longFunding.plus(fundingAmount); // Longs owe shorts
            } else if (fundingRate < 0 && pos.contracts < 0) {
                shortFunding = shortFunding.plus(fundingAmount); // Shorts owe longs
            }
        }

        // **Distribute funding payments**
        if (fundingRate > 0) {
            console.log(`💳 Longs pay shorts: ${longFunding}`);
            await Clearing.processFundingPayments(longs, shorts, longFunding, contractId, block);
        } else if (fundingRate < 0) {
            console.log(`💳 Shorts pay longs: ${shortFunding}`);
            await Clearing.processFundingPayments(shorts, longs, shortFunding, contractId, block);
        }
    }


    static async processFundingPayments(payers, receivers, totalFunding, contractId, block) {
        if (totalFunding.isZero()) return;

        const collateralId = await ContractRegistry.getCollateralId(contractId);
        let totalContracts = payers.reduce((sum, pos) => sum.plus(Math.abs(pos.contracts)), new BigNumber(0));

        if (totalContracts.isZero()) return;

        for (let pos of payers) {
            let contractsBN = new BigNumber(Math.abs(pos.contracts));
            let amountOwed = totalFunding.times(contractsBN.dividedBy(totalContracts)).decimalPlaces(8);

            console.log(`💸 Funding Deduction: ${pos.address} pays ${amountOwed}`);

            await TallyMap.updateBalance(pos.address, collateralId, -amountOwed.toNumber(), 0, 0, 0, 'fundingFee', block);
        }

        totalContracts = receivers.reduce((sum, pos) => sum.plus(Math.abs(pos.contracts)), new BigNumber(0));

        for (let pos of receivers) {
            let contractsBN = new BigNumber(Math.abs(pos.contracts));
            let amountReceived = totalFunding.times(contractsBN.dividedBy(totalContracts)).decimalPlaces(8);

            console.log(`💰 Funding Credit: ${pos.address} receives ${amountReceived}`);

            await TallyMap.updateBalance(pos.address, collateralId, amountReceived.toNumber(), 0, 0, 0, 'fundingCredit', block);
        }
    }

    static async getIndexPrice(contractId, blockHeight) {
        try {
            const ContractRegistry = require('./contractRegistry.js');
            const OracleRegistry = require('./oracle.js');
            const VolumeIndex = require('./volumeIndex.js');
            const db = require('./db.js');

            const contractInfo = await ContractRegistry.getContractInfo(contractId);
            if (!contractInfo) {
                console.error(`❌ Contract ${contractId} not found.`);
                return null;
            }

            if (contractInfo.native) {
                // **For native contracts, use Volume Index (DEX trade data)**
                const pairKey = `${contractInfo.notionalPropertyId}-${contractInfo.collateralPropertyId}`;
                const volumeIndexDB = await db.getDatabase('volumeIndex');

                const volumeData = await volumeIndexDB.findAsync({ _id: pairKey });
                if (!volumeData || volumeData.length === 0) {
                    console.warn(`⚠️ No volume data found for pair ${pairKey}.`);
                    return null;
                }

                // **Sort by blockHeight descending & get latest**
                const sortedData = volumeData.sort((a, b) => b.value.blockHeight - a.value.blockHeight);
                const latestEntry = sortedData.find(entry => entry.value.blockHeight <= blockHeight);

                if (latestEntry) {
                    console.log(`📊 Latest native index price for ${pairKey}: ${latestEntry.value.price} (at block ${latestEntry.value.blockHeight})`);
                    return latestEntry.value.price;
                }
            } else {
                // **For oracle contracts, get the latest oracle price**
                const oracleId = contractInfo.underlyingOracleId;
                const latestOracleData = await OracleRegistry.getOraclePrice(oracleId);

                if (!latestOracleData || latestOracleData.blockHeight > blockHeight) {
                    console.warn(`⚠️ No valid oracle data found for Oracle ID ${oracleId}.`);
                    return null;
                }

                console.log(`📊 Latest oracle price for contract ${contractId}: ${latestOracleData.price} (at block ${latestOracleData.blockHeight})`);
                return latestOracleData.price;
            }

            return null;
        } catch (error) {
            console.error(`❌ Error retrieving index price for contract ${contractId}:`, error.message);
            return null;
        }
    }

        // Define each of the above methods with corresponding logic based on the C++ functions provided
        // ...static async feeCacheBuy(block) {  

    static async updateAllPositions(blockHeight, contractRegistry) {
      // Fetch all valid contract IDs (adjust this function to your environment)
      const ContractRegistry = require('./contractRegistry.js')
      const contracts = await ContractRegistry.getAllContracts();

      for (const contract of contracts) {
        const contractId = contract.id; // ✅ Extract only the contract ID
        //console.log(`Updating positions for contract ${contractId} at block ${blockHeight}`);

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
            if(blockHeight%1000){
            //Clearing.reconcileReserve(pos.address,collateralPropertyId)
            }
        /*  // 1. Recalculate bankruptcy/liquidation prices.
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
          }*/

          // Update the position in the margin map.
          //marginMap.margins.set(pos.address, pos);
          //console.log(`Final state for ${pos.address} on contract ${contractId}: contracts=${pos.contracts}, margin=${pos.margin}, liqPrice=${pos.liquidationPrice}`);
        }

        // Save the updated margin map for this contract.
        await marginMap.saveMarginMap(blockHeight);
      }
      //console.log(`Finished updating positions for all contracts at block ${blockHeight}`);
    }

    static async reconcileReserve(address, collateralId,block) {
        console.log(`🔄 Reconciling reserved balance for ${address}`);
        const ContractRegistry = require("./contractRegistry.js");
        const TallyMap = require("./tally.js");
        const Orderbooks = require("./orderbook.js")
        const tally = await TallyMap.getTally(address, collateralId);
        const allContracts = await ContractRegistry.getAllContractsForCollateral(address, collateralId);

        let totalReservedAcrossOrders = new BigNumber(0);

        for (const contractId of allContracts) {
            // Load the orderbook instance for the contract
            const orderbook = await Orderbooks.getOrderbookInstance(contractId);
            console.log('book for '+contractId+' '+orderbook)
            if (!orderbook || !orderbook.orderBooks[contractId]) continue;
            console.log('total reserved '+totalReservedAcrossOrders.toNumber())
            // Add the reserve amount for this contract
            totalReservedAcrossOrders = totalReservedAcrossOrders.plus(orderbook.getReserveByAddress(address,contractId));
            console.log('total reserved '+totalReservedAcrossOrders.toNumber())
        }
        // Compare total reserved margin to tallyMap reserved balance
        const excess = new BigNumber(tally.reserved).minus(totalReservedAcrossOrders);

        if (excess.gt(0)) {
            console.log(`📉 Returning ${excess.toFixed(8)} excess from reserved to available for ${address}`);
            await TallyMap.updateBalance(address, collateralId, excess.toNumber(), -excess.toNumber(), 0, 0, "reserveReconciliation", block);
        } else {
            console.log(`✅ No excess reserve found for ${address}.`);
        }
        return excess
    }

    static async sourceLoss(
        address,
        contractId,
        collateralId,
        requiredLoss,
        blockHeight
    ) {
        const Tally = require('./tally.js');
        const Orderbook = require('./orderbook.js');

        let remaining = new BigNumber(requiredLoss);

        console.log(`🧮 BEGIN LOSS SOURCING for ${address}, need ${remaining.toFixed(8)}`);

        // 1. Use available balance
        const t0 = await Tally.getTally(address, collateralId);
        let avail = new BigNumber(t0.available || 0);

        if (avail.gt(0)) {
            const useA = BigNumber.min(avail, remaining);
            console.log(`➡️ Using available ${useA}`);
            await Tally.updateBalance(address, collateralId, -useA, 0, 0, 0, "loss_from_available", blockHeight);
            remaining = remaining.minus(useA);
        }

        if (remaining.lte(0)) return { remaining: 0, stage: "available" };

        // 2. Use margin on THIS contract (by canceling orders and freeing reserved)
        console.log(`➡️ Sweeping contract-local orders for ${contractId}`);
        await Orderbook.cancelExcessOrders(address, contractId, remaining, collateralId, blockHeight);

        await Clearing.reconcileReserve(address, collateralId, blockHeight);

        let t1 = await Tally.getTally(address, collateralId);
        let avail1 = new BigNumber(t1.available || 0);

        let freedLocal = avail1.minus(avail);
        if (freedLocal.gt(0)) {
            const useLocal = BigNumber.min(freedLocal, remaining);
            console.log(`✔ Local freed ${useLocal}, applying to loss`);
            await Tally.updateBalance(address, collateralId, -useLocal, 0, 0, 0, "loss_local_reserve", blockHeight);
            remaining = remaining.minus(useLocal);
            avail = avail1.minus(useLocal);
        }

        if (remaining.lte(0)) return { remaining: 0, stage: "localReserve" };

        // 3. Cross-contract reserve scavenging
        console.log(`➡️ Cross-contract scavenging…`);
        const x = await Clearing.sourceCrossContractReserve(
            address,
            collateralId,
            remaining,
            contractId,
            blockHeight
        );

        remaining = x.remaining;

        // 4. Reconcile after scavenging
        await Clearing.reconcileReserve(address, collateralId, blockHeight);

        console.log(`🏁 LOSS SOURCING END — remaining: ${remaining}`);

        return {
            remaining: remaining.toNumber(),
            stage: remaining.gt(0) ? "residual" : "cleared"
        };
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

    // ---------------------------------------------------------------------------
    // isPriceUpdatedForBlockHeight (drop-in replacement)
    // Returns object:
    // {
    //   updated: boolean,
    //   lastPrice: number|null,
    //   thisPrice: number|null,
    //   blockHeight: number,
    //   contractId: number|string,
    //   isOracle: boolean,
    //   oracleId?: number|null
    // }
    // ---------------------------------------------------------------------------
    static async isPriceUpdatedForBlockHeight(contractId, blockHeight) {
        const ContractRegistry = require('./contractRegistry.js');
        const base = await db.getDatabase('oracleData');
        const volumeIndexDB = await db.getDatabase('volumeIndex');

        try {
            const isOracle = await ContractRegistry.isOracleContract(contractId);

            // -------------------------
            // ORACLE CONTRACT
            // -------------------------
            if (isOracle) {
                const oracleId = await ContractRegistry.getOracleId(contractId);
                const cached = Clearing.latestOracleMarkById.get(oracleId);
                const lastPrice = cached ? cached.price : null;

                // Only check THIS block for a new oracle mark
                const rows = await base.findAsync({ oracleId, blockHeight });
                const entry = Array.isArray(rows) && rows.length ? rows[0] : null;
                const thisPrice = entry?.data?.price ?? null;

                if (thisPrice != null) {
                    Clearing.latestOracleMarkById.set(oracleId, { price: thisPrice, blockHeight });

                    return {
                        updated: (lastPrice == null || thisPrice !== lastPrice),
                        lastPrice,
                        thisPrice,
                        blockHeight,
                        contractId,
                        isOracle: true,
                        oracleId
                    };
                }

                // Prime cache once if empty (lightweight max scan, no sort)
                if (lastPrice == null) {
                    const all = await base.findAsync({ oracleId });
                    if (Array.isArray(all) && all.length) {
                        let best = all[0];
                        for (const row of all) {
                            if ((row.blockHeight || 0) > (best.blockHeight || 0)) best = row;
                        }
                        const p = best?.data?.price ?? null;
                        if (p != null) {
                            Clearing.latestOracleMarkById.set(oracleId, { price: p, blockHeight: best.blockHeight });
                        }
                    }
                }

                return {
                    updated: false,
                    lastPrice: Clearing.latestOracleMarkById.get(oracleId)?.price ?? null,
                    thisPrice: null,
                    blockHeight,
                    contractId,
                    isOracle: true,
                    oracleId
                };
            }

            // -------------------------
            // NATIVE CONTRACT
            // -------------------------
            const cached = Clearing.latestNativeMarkById.get(contractId);
            const lastPrice = cached ? cached.price : null;

            let pairKey = null;
            try {
                const info = await ContractRegistry.getContractInfo(contractId);
                if (info?.notionalPropertyId != null && info?.collateralPropertyId != null) {
                    pairKey = `${info.notionalPropertyId}-${info.collateralPropertyId}`;
                }
            } catch (e) {}

            // Try pairKey doc first, then contractId doc
            let docArr = [];
            if (pairKey) {
                docArr = await volumeIndexDB.findAsync({ _id: pairKey });
            }
            if (!Array.isArray(docArr) || docArr.length === 0) {
                docArr = await volumeIndexDB.findAsync({ _id: contractId });
            }

            const doc = Array.isArray(docArr) && docArr.length ? docArr[0] : null;
            const docBlock = doc?.value?.blockHeight ?? doc?.blockHeight ?? null;
            const thisPrice = doc?.value?.price ?? doc?.data?.price ?? null;

            // If there is a price entry at THIS block, update cache + return object
            if (thisPrice != null && docBlock === blockHeight) {
                Clearing.latestNativeMarkById.set(contractId, { price: thisPrice, blockHeight: docBlock });

                return {
                    updated: (lastPrice == null || thisPrice !== lastPrice),
                    lastPrice,
                    thisPrice,
                    blockHeight,
                    contractId,
                    isOracle: false,
                    oracleId: null
                };
            }

            // Prime cache if empty
            if (lastPrice == null && thisPrice != null && docBlock != null) {
                Clearing.latestNativeMarkById.set(contractId, { price: thisPrice, blockHeight: docBlock });
            }

            return {
                updated: false,
                lastPrice: Clearing.latestNativeMarkById.get(contractId)?.price ?? null,
                thisPrice: null,
                blockHeight,
                contractId,
                isOracle: false,
                oracleId: null
            };

        } catch (error) {
            console.error(`Error checking price update for contract ID ${contractId}:`, error.message);

            return {
                updated: false,
                lastPrice: null,
                thisPrice: null,
                blockHeight,
                contractId,
                isOracle: false,
                oracleId: null,
                error: error.message
            };
        }
    }

    static async settleNewContracts(contractId, blockHeight, priceInfo) {
      const BigNumber = require('bignumber.js');
      const Tally = require('./tally.js');
      const ContractRegistry = require('./contractRegistry.js');
      const MarginMap = require('./marginMap.js');

      // Need a canonical previous mark to tie off entry -> lastMark
      const lastMark = priceInfo?.lastPrice ?? null;
      if (lastMark == null) return;

      // Early exit if nobody has positions
      const mm = await MarginMap.getInstance(contractId);
      const positions = await mm.getAllPositions(contractId);
      if (!Array.isArray(positions) || positions.length === 0) return;

      // Resolve contract params inside
      const collateralId = await ContractRegistry.getCollateralId(contractId);
      const inverse = await ContractRegistry.isInverse(contractId);

      // Notional per contract (use lastMark as the reference price for any price-dependent notional)
      const notionalObj = await ContractRegistry.getNotionalValue(contractId, lastMark);
      const notional = notionalObj?.notionalPerContract ?? notionalObj ?? 1;

      // Build opened stats from the correct trade window
      const plan = await Clearing.getMarkTradeWindow(priceInfo, contractId);

      const openedByAddress = new Map();
      const openedCostByAddress = new Map();

      // A) DB trades when needed
      if (plan?.mustQueryHistory) {
        const tradeHistoryManager = new TradeHistory();
        const trades = await tradeHistoryManager.getTradesForContractBetweenBlocks(
          contractId,
          plan.startBlock,
          plan.endBlock
        );

        for (const t of trades || []) {
          Clearing.applyTradeToOpenStats(openedByAddress, openedCostByAddress, t);
        }
      }

      // B) RAM blockTrades when safe
      if (plan?.useBlockTrades) {
        for (const [key, entryRaw] of Clearing.blockTrades.entries()) {
          if (!key.startsWith(`${contractId}:`)) continue;
          const address = key.split(':')[1];

          const entry = Clearing._normalizeEntry(entryRaw);
          for (const t of (entry.trades || [])) {
            // t is your local tradeObj: { opened, closed, consumedFromOpened, price, openedBefore }
            const openedSigned = new BigNumber(t?.opened || 0);
            if (openedSigned.isZero()) continue;

            const px = new BigNumber(t?.price || 0);
            if (px.lte(0)) continue;

            const prevOpen = new BigNumber(openedByAddress.get(address) || 0);
            openedByAddress.set(address, prevOpen.plus(openedSigned).toNumber());

            const prevCost = new BigNumber(openedCostByAddress.get(address) || 0);
            openedCostByAddress.set(
              address,
              prevCost.plus(openedSigned.abs().times(px)).toNumber()
            );
          }
        }
      }

      const openedAvgByAddress = Clearing.computeOpenedAvgByAddress(openedByAddress, openedCostByAddress);

      // Tie off entry -> lastMark
      for (const [address, openedSignedNum] of openedByAddress.entries()) {
        const openedSigned = new BigNumber(openedSignedNum || 0);
        if (openedSigned.isZero()) continue;

        const avgEntry = openedAvgByAddress.get(address);
        if (!avgEntry) continue;

        const pnlTie = Clearing.calculateNewContractPNL({
          newContracts: openedSigned.toNumber(), // signed
          avgEntryPrice: avgEntry,
          lastPrice: lastMark,
          inverse,
          notional
        });

        if (!pnlTie.isZero()) {
          await Tally.updateBalance(
            address,
            collateralId,
            pnlTie.toNumber(),
            0, 0, 0,
            'newContractTieOff',
            blockHeight
          );
        }
      }
    }


    static async makeSettlement(blockHeight) {
        const ContractRegistry = require('./contractRegistry.js');
        const contracts = await ContractRegistry.loadContractSeries();
        if (!contracts) return;

        for (const contract of contracts) {
            const id = contract[1].id;
            const priceInfo = await Clearing.isPriceUpdatedForBlockHeight(id, blockHeight);
            Clearing.settleNewContracts(id,blockHeight,priceInfo)
            if (!priceInfo || !priceInfo.updated) continue;

            const newPrice = priceInfo.thisPrice;
            console.log('new price ' + newPrice);
            console.log('Making settlement for positions at block height:', JSON.stringify(contract) + ' ' + blockHeight);

            const collateralId = await ContractRegistry.getCollateralId(id);
            const inverse = await ContractRegistry.isInverse(id);

            const notionalValue = await ContractRegistry.getNotionalValue(id, newPrice);
            console.log('notional obj ' + JSON.stringify(notionalValue));

            let { positions, liqEvents, systemicLoss, pnlDelta } =
                await Clearing.updateMarginMaps(
                    blockHeight,
                    id,
                    collateralId,
                    inverse,
                    notionalValue.notionalPerContract,
                    priceInfo // ✅ pass the object
                );

            console.log('is liq ' + JSON.stringify(liqEvents));
            console.log('length ' + liqEvents.length + ' ' + Boolean(liqEvents.length > 0));

            if (liqEvents.length > 0) {
                await Clearing.performAdditionalSettlementTasks(
                    blockHeight,
                    positions,
                    id,
                    newPrice,
                    systemicLoss,
                    collateralId,
                    pnlDelta
                );
            }
        }

        await Clearing.resetBlockTrades();
        return;
    }


    /**
     * Normalize all position lastMark values to match the canonical previous mark
     * from the oracle/price blob for this block.
     *
     * Ensures consistent mark-to-market accounting and prevents asymmetric PNL.
     *
     * @param {Array} positions - array of position objects from marginMap.getAllPositions()
     * @param {Number} canonicalLastMark - blob.lastPrice (true previous mark)
     * @param {Object} marginMap - reference to marginMap object (must provide savePosition)
     * @param {Number} contractId
     */
    static async normalizePositionMarks(positions, canonicalLastMark, marginMap, contractId,block){
        for (let pos of positions) {
            if (pos.lastMark !== canonicalLastMark) {
                console.log(
                    `🔧 [normalize] Updating lastMark for ${pos.address}: ` +
                    `${pos.lastMark}  →  ${canonicalLastMark}`
                );

                pos.lastMark = canonicalLastMark;
                //marginMap.margins.set(pos.address, pos);  
            }
        }
        //await marginMap.saveMarginMap(block)
    }

    // clearing.js
    static applyTradeToOpenStats(openedByAddress, openedCostByAddress, trade) {
      const BigNumber = require('bignumber.js');

      const amount = new BigNumber(trade?.amount || 0);
      if (amount.lte(0)) return;

      const price = new BigNumber(trade?.price || 0);
      if (price.lte(0)) return; // can't compute avg without price

      const buyer = trade?.buyerAddress;
      const seller = trade?.sellerAddress;

      const buyerClose = new BigNumber(trade?.buyerClose || 0);
      const sellerClose = new BigNumber(trade?.sellerClose || 0);

      // ✅ closes do NOT count as new exposure
      const buyerOpenedAbs = BigNumber.max(new BigNumber(0), amount.minus(buyerClose));
      const sellerOpenedAbs = BigNumber.max(new BigNumber(0), amount.minus(sellerClose));

      // buyer opens long
      if (buyer && buyerOpenedAbs.gt(0)) {
        const prevOpen = new BigNumber(openedByAddress.get(buyer) || 0);
        openedByAddress.set(buyer, prevOpen.plus(buyerOpenedAbs).toNumber());

        const prevCost = new BigNumber(openedCostByAddress.get(buyer) || 0);
        openedCostByAddress.set(
          buyer,
          prevCost.plus(buyerOpenedAbs.multipliedBy(price)).toNumber()
        );
      }

      // seller opens short
      if (seller && sellerOpenedAbs.gt(0)) {
        const prevOpen = new BigNumber(openedByAddress.get(seller) || 0);
        openedByAddress.set(seller, prevOpen.minus(sellerOpenedAbs).toNumber());

        // cost stored as ABS cost for avg calc
        const prevCost = new BigNumber(openedCostByAddress.get(seller) || 0);
        openedCostByAddress.set(
          seller,
          prevCost.plus(sellerOpenedAbs.multipliedBy(price)).toNumber()
        );
      }
    }

    static computeOpenedAvgByAddress(openedByAddress, openedCostByAddress) {
          const BigNumber = require('bignumber.js');
          const out = new Map();

          for (const [addr, openedSignedNum] of openedByAddress.entries()) {
            const openedSigned = new BigNumber(openedSignedNum || 0);
            const openedAbs = openedSigned.abs();
            const costAbs = new BigNumber(openedCostByAddress.get(addr) || 0);

            if (openedAbs.gt(0) && costAbs.gt(0)) {
              out.set(addr, costAbs.div(openedAbs).toNumber());
        } else {
          out.set(addr, null);
        }
      }

      return out;
    }

 
   static async updateMarginMaps(blockHeight, contractId, collateralId, inverse, notional, priceInfo) {

      console.log(`\n=== UPDATE MARGIN MAPS: contract=${contractId} block=${blockHeight} ===`);

      const MarginMap = require('./marginMap.js');
      const Orderbook = require('./orderbook.js');
      const Tally     = require('./tally.js');
      const BigNumber = require('bignumber.js');

      const marginMap = await MarginMap.getInstance(contractId);

      // ------------------------------------------------------------
      // 1) Load raw positions → init clearing cache
      // ------------------------------------------------------------
      const rawPositions = await marginMap.getAllPositions(contractId);
      const ctxKey = Clearing.initPositionCache(contractId, blockHeight, rawPositions);
      let positions = Clearing.getPositionsFromCache(ctxKey);

      if (!Array.isArray(positions) || positions.length === 0) {
        Clearing.flushPositionCache(ctxKey);
        return { positions: [], liqEvents: [], systemicLoss: new BigNumber(0), pnlDelta: new BigNumber(0) };
      }

      // ------------------------------------------------------------
      // 2) Resolve priceInfo ONCE
      // ------------------------------------------------------------
      let blob = priceInfo;
      if (!blob || blob.thisPrice == null) {
        blob = await Clearing.isPriceUpdatedForBlockHeight(contractId, blockHeight);
      }

      let lastPrice = blob?.lastPrice ?? null;
      let thisPrice = blob?.thisPrice ?? null;

      // If we somehow have no last mark, we cannot do a consistent mark-to-mark
      if (lastPrice == null) {
        const finalPositions = Clearing.flushPositionCache(ctxKey);
        await marginMap.mergePositions(finalPositions, contractId, true);
        return { positions, liqEvents: [], systemicLoss: new BigNumber(0), pnlDelta: new BigNumber(0) };
      }

      // If thisPrice missing, treat as no move (shouldn’t happen when called on updated marks, but safe)
      if (thisPrice == null) thisPrice = lastPrice;

      await Clearing.normalizePositionMarks(
        positions,
        lastPrice,
        null,
        contractId,
        blockHeight
      );

      console.log(`📈 Price diff: last=${lastPrice} → this=${thisPrice}`);

      // ------------------------------------------------------------
      // 3) Accumulators
      // ------------------------------------------------------------
      let systemicLoss = new BigNumber(0);
      let totalPos     = new BigNumber(0);
      let totalNeg     = new BigNumber(0);

      const orderbook = await Orderbook.getOrderbookInstance(contractId);
      const liqQueue  = [];

      // ------------------------------------------------------------
      // 4) FIRST PASS — Compute mark-to-mark PNL and check solvency
      // ------------------------------------------------------------
      for (const pos of positions) {
        if (!pos?.contracts) continue;

        const tally = await Tally.getTally(pos.address, collateralId);

        // PURE mark-to-mark on full position (new exposure was already tied-off to lastMark)
        const pnl = Clearing.calculateClearingPNL({
          oldContracts: pos.contracts,
          previousMarkPrice: lastPrice,
          currentMarkPrice: thisPrice,
          inverse,
          notional
        });

        console.log(
          `[CLEARING] addr=${pos.address} c=${pos.contracts} mark=${lastPrice}->${thisPrice} pnl=${pnl.toFixed()}`
        );

        // PROFIT: defer credit until after ADL, because size may change
        if (pnl.gt(0)) {
          pos._wasProfitable = true;
          continue;
        }

        // LOSS
        const loss = pnl.abs();
        const available = new BigNumber(tally.available || 0);
        const maintMargin = new BigNumber(tally.margin || 0).div(2);
        const coverage = available.plus(maintMargin);

        totalNeg = totalNeg.plus(loss);

        if (coverage.gte(loss)) {
          // SOLVENT → PAY LOSS IMMEDIATELY
          await Tally.updateBalance(
            pos.address,
            collateralId,
            pnl.toNumber(),  // negative number
            0, 0, 0,
            'clearingLoss',
            blockHeight
          );
          continue;
        }

        // INSUFFICIENT FUNDS → LIQUIDATE
        const shortfall = loss.minus(coverage);

        liqQueue.push({
          address: pos.address,
          pos,
          loss,
          shortfall,
          coverage
        });
      }

      // ------------------------------------------------------------
      // 5) SECOND PASS — Process liquidation (handleLiquidation)
      // ------------------------------------------------------------
      const liqEvents = [];

      for (const q of liqQueue) {
        const tally = await Tally.getTally(q.address, collateralId);

        const liquidationType = q.coverage.gt(0) ? "partial" : "total";

        const liq = await Clearing.handleLiquidation(
          ctxKey,
          orderbook,
          Tally,
          q.pos,
          contractId,
          blockHeight,
          inverse,
          collateralId,
          liquidationType,
          q.shortfall.toNumber(),   // dent (positive)
          notional,
          thisPrice,
          true,
          q.shortfall.toNumber(),   // markShortfall
          tally
          // (if your handleLiquidation signature still has extra args, keep them here as you had)
        );

        if (!liq) continue;

        systemicLoss = systemicLoss.plus(liq.systemicLoss);

        liqEvents.push({
          address: q.address,
          liquidationType,
          shortfall: q.shortfall.toNumber(),
          coverage: q.coverage.toNumber(),
          loss: q.loss.toNumber(),
          systemicLoss: liq.systemicLoss,
          contractsLiquidated: liq.totalDeleveraged ?? 0,
          counterparties: liq.counterparties ?? []
        });

        if (liq.counterparties?.length > 0) {
          positions = Clearing.updatePositions(positions, liq.counterparties);
        }
      }

      // ------------------------------------------------------------
      // 6) THIRD PASS — Credit profits (post-ADL sizes)
      // ------------------------------------------------------------
      positions = Clearing.getPositionsFromCache(ctxKey);

      for (const pos of positions) {
        if (!pos?.contracts) {
          delete pos._wasProfitable;
          continue;
        }

        // Recompute profit with current post-ADL size
        const profit = Clearing.calculateClearingPNL({
          oldContracts: pos.contracts,
          previousMarkPrice: lastPrice,
          currentMarkPrice: thisPrice,
          inverse,
          notional
        });

        if (profit.gt(0)) {
          totalPos = totalPos.plus(profit);

          await Tally.updateBalance(
            pos.address,
            collateralId,
            profit.toNumber(),
            0, 0, 0,
            'clearingProfit',
            blockHeight
          );
        }

        delete pos._wasProfitable;
      }

      // ------------------------------------------------------------
      // 7) SYSTEMIC ACCOUNTING
      // ------------------------------------------------------------
      totalNeg = totalNeg.minus(systemicLoss);
      const pnlDelta = totalPos.minus(totalNeg);

      // ------------------------------------------------------------
      // 8) WRITE POSITIONS
      // ------------------------------------------------------------
      const finalPositions = Clearing.flushPositionCache(ctxKey);
      await marginMap.mergePositions(finalPositions, contractId, true);

      return { positions, liqEvents, systemicLoss, pnlDelta };
    }

    static async getMarkTradeWindow(priceInfo,contractId) {
        // priceInfo is the object you now return from isPriceUpdatedForBlockHeight
        // Expected minimal fields:
        //  - priceInfo.thisPrice
        //  - priceInfo.lastPrice (optional)
        //  - priceInfo.blockHeight  (the block where the new mark lives)
        //  - priceInfo.prevBlockHeight (optional but ideal)

        const markBlock = priceInfo?.blockHeight ?? null;
        const prevBlock = priceInfo?.prevBlockHeight ?? null;
        const tradeHistoryManager = new TradeHistory()
        if (prevBlock == null && markBlock != null) {
            const firstTradeBlock =
                await tradeHistoryManager.getFirstTradeBlock(contractId);

            return {
                isBootstrap: true,
                mustQueryHistory: true,
                startBlock: firstTradeBlock ?? thisMarkBlock,
                endBlock: markBlock,
                useBlockTrades: false
            };
        }


        if (!markBlock) {
            return {
                useBlockTrades: false,
                mustQueryHistory: false,
                startBlock: null,
                endBlock: null,
                reason: "No markBlock in priceInfo"
            };
        }

        // If we don't know the previous mark block, safest assumption is:
        // same-block cache is NOT sufficient for avgPrice history reconstruction.
        if (!prevBlock) {
            return {
                useBlockTrades: false,
                mustQueryHistory: true,
                startBlock: markBlock,   // conservative default
                endBlock: markBlock,
                reason: "Missing prevBlockHeight; require history"
            };
        }

        const gap = markBlock - prevBlock;

        // gap === 0 means a mark update that effectively references same block interval
        // but in practice markBlock >= prevBlock, and we care if there were trades
        // in blocks between these marks.
        if (gap <= 0) {
            return {
                useBlockTrades: true,
                mustQueryHistory: false,
                startBlock: markBlock,
                endBlock: markBlock,
                reason: "No inter-block gap"
            };
        }

        // There is a discontinuity: blockTrades only holds current-block trades.
        // For avgPrice correctness you need trades from prevBlock..markBlock.
        return {
            useBlockTrades: false,
            mustQueryHistory: true,
            startBlock: prevBlock + 1,
            endBlock: markBlock,
            reason: `Gap of ${gap} blocks`
        };
    }



    static applyLossPoolDrain(tally, loss) {
        const result = {
            fromAvailable: 0,
            fromMargin: 0,
            shortfall: 0
        };

        let remaining = new BigNumber(loss);

        // 1. Drain available
        const useAvail = BigNumber.min(remaining, tally.available);
        result.fromAvailable = useAvail;
        remaining = remaining.minus(useAvail);

        // 2. Drain margin (but limited to actual margin)
        const useMargin = BigNumber.min(remaining, tally.margin);
        result.fromMargin = useMargin;
        remaining = remaining.minus(useMargin);

        // 3. Whatever remains is shortfall → ADL only
        result.shortfall = remaining;

        return result;
    }


    static flattenMark(positions) {
      positions.forEach(pos => {
        if (pos.contracts === 0) {
          pos.lastMark = null;
        }
      });
      return positions;
    }

    // ============================================
    // ADD TO clearing.js - new helper function
    // ============================================
    static calculateMarkToMarkPNL({ contracts, fromPrice, toPrice, inverse, notional }) {
        const Big = BigNumber;
        const c = new Big(contracts);
        const from = new Big(fromPrice);
        const to = new Big(toPrice);
        const n = new Big(notional || 1);

        if (from.isZero() || to.isZero()) {
            return new Big(0);
        }

        let pnl;
        if (!inverse) {
            // Linear: PNL = (toPrice - fromPrice) * contracts * notional
            pnl = to.minus(from).times(c).times(n);
        } else {
            // Inverse: PNL = (1/fromPrice - 1/toPrice) * contracts * notional
            pnl = new Big(1).div(from).minus(new Big(1).div(to)).times(c).times(n);
        }

        return pnl.dp(8);
    }

    static recomputeContractBalanceSnapshot(pos, remainder, price, isLong, inverse) {
        const p = { ...pos };

        // same logic you already used inside marginMap.updateContractBalances
        // but applied *locally* to the cloned position

        if (remainder > 0) {
            p.contracts = remainder;
        } else {
            p.contracts = 0;
            p.avgPrice = 0;
        }

        p.lastMark = price;
        return p;
    }


    // Make sure BigNumber is imported:
    // const BigNumber = require("bignumber.js");
    static computeLiquidationPriceFromLoss(markPrice, systemicLoss, contracts, notional, inverse){
      // We'll use feePercent = 0 and high internal precision
      const feePercent = new BigNumber(0);
      const PRECISION = 30; // high precision for internal calculations

      const BNMark = new BigNumber(markPrice);
      const BNSystemicLoss = new BigNumber(systemicLoss);
      const BNContracts = new BigNumber(contracts);
      const BNNotional = new BigNumber(notional);

      if (!inverse) {
        let baseLiqPrice;
        if (BNContracts.gt(0)) {
          // For long positions:
          // liqPrice = markPrice - (systemicLoss / (contracts * notional))
          baseLiqPrice = BNMark.minus(BNSystemicLoss.dividedBy(BNContracts.multipliedBy(BNNotional)));
          // Fee adjustment is trivial with feePercent 0, so just return with high precision:
          console.log('baseLiq price >0 '+baseLiqPrice+' '+markPrice+' '+systemicLoss+' '+contracts+' '+notional)
          return baseLiqPrice.decimalPlaces(PRECISION);
        } else if (BNContracts.lt(0)) {
          // For short positions:
          // liqPrice = markPrice + (systemicLoss / (|contracts| * notional))
          baseLiqPrice = BNMark.plus(BNSystemicLoss.dividedBy(BNContracts.absoluteValue().multipliedBy(BNNotional)));
          console.log('baseLiq price <0 '+baseLiqPrice+' '+markPrice+' '+systemicLoss+' '+contracts+' '+notional)
          return baseLiqPrice.decimalPlaces(PRECISION);
        }
        return null;
      } else {
        let baseLiqPrice;
        if (BNContracts.gt(0)) {
          // Inverse Long:
          // 1/liqPrice = 1/markPrice + (systemicLoss / (contracts * notional))
          const invLiq = new BigNumber(1).dividedBy(BNMark)
                          .plus(BNSystemicLoss.dividedBy(BNContracts.multipliedBy(BNNotional)));
          baseLiqPrice = new BigNumber(1).dividedBy(invLiq);
          return baseLiqPrice.decimalPlaces(PRECISION);
        } else if (BNContracts.lt(0)) {
          // Inverse Short:
          // 1/liqPrice = 1/markPrice - (systemicLoss / (|contracts| * notional))
          const invLiq = new BigNumber(1).dividedBy(BNMark)
                          .minus(BNSystemicLoss.dividedBy(BNContracts.absoluteValue().multipliedBy(BNNotional)));
          baseLiqPrice = new BigNumber(1).dividedBy(invLiq);
          return baseLiqPrice.decimalPlaces(PRECISION);
        }
        return null;
      }
    }

    static getOpenedByAddressFromTrades(relevantTrades) {
        const openedByAddress = new Map();

        if (!Array.isArray(relevantTrades)) return openedByAddress;

        for (const t of relevantTrades) {
            const trade = t?.trade ?? t;
            if (!trade) continue;

            const amt = Number(trade.amount || 0);
            if (!amt) continue;

            const buyer  = trade.buyerAddress;
            const seller = trade.sellerAddress;

            if (buyer) {
                openedByAddress.set(
                    buyer,
                    (openedByAddress.get(buyer) || 0) + amt
                );
            }

            if (seller) {
                openedByAddress.set(
                    seller,
                    (openedByAddress.get(seller) || 0) - amt
                );
            }
        }

        return openedByAddress;
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


    static async handleLiquidation(
        ctxKey,
        orderbook,
        Tally,
        position,
        contractId,
        blockHeight,
        inverse,
        collateralId,
        liquidationType,    // "partial" | "total"
        marginDent,          // positive number = margin to debit
        notional,
        markPrice,
        applyDent,
        markShortfall,
        tallySnapshot
    ) {
        const Clearing = this;
        const MarginMap = require('./marginMap.js');
        const marginMap = await MarginMap.getInstance(contractId);

        const Big = BigNumber.clone();
        const liquidatingAddress = position.address;

        console.log(`🔥 handleLiquidation(${liquidationType}) for ${liquidatingAddress}`);

        //------------------------------------------------------------
        // 0. Load cache snapshot
        //------------------------------------------------------------
        const positionCache = Clearing.getPositionsFromCache(ctxKey);

        //------------------------------------------------------------
        // 1. Compute liquidation size (liqAmount)
        //------------------------------------------------------------
        const tally = tallySnapshot || await Tally.getTally(liquidatingAddress, collateralId);

        const maintReq = new Big(await marginMap.checkMarginMaintainance(
            liquidatingAddress,
            contractId,
            position
        ) || 0);

        const equity = new Big(tally.margin || 0).plus(tally.available || 0);
        const deficit = maintReq.minus(equity);

        let liqAmount;
        const absContracts = Math.abs(position.contracts);

        if (deficit.gt(0) && deficit.lte(new Big(tally.margin || 0))) {
            // partial liquidation to cure margin dent
            const ContractRegistry = require('./contractRegistry.js');
            const initPerContract = new Big(
                await ContractRegistry.getInitialMargin(contractId, markPrice)
            );

            liqAmount = Big.min(
                absContracts,
                deficit.div(initPerContract).dp(8)
            ).toNumber();

            liquidationType = "partial";
        } else {
            liqAmount = absContracts;
            liquidationType = "total";
        }

        if (liqAmount <= 0) {
            console.log(`⚠️ no liquidation amount for ${liquidatingAddress}`);
            return null;
        }

        //------------------------------------------------------------
        // 2. Compute bankruptcy / liquidation price
        //------------------------------------------------------------
        markShortfall ??= 0;

        let lossBudget = new Big(markShortfall);
        if (lossBudget.lte(0)) {
            lossBudget = new Big(tally.margin || 0).plus(tally.available || 0);
        }

        const computedLiqPrice = Clearing.computeLiquidationPriceFromLoss(
            markPrice,
            lossBudget.toNumber(),
            position.contracts,
            notional,
            inverse
        );

        //------------------------------------------------------------
        // 3. Generate liquidation order object
        //------------------------------------------------------------
        let liq = await marginMap.generateLiquidationOrder(
            position,
            contractId,
            liquidationType === "total",
            blockHeight
        );

        if (!liq || liq === "err:0 contracts") return null;

        liq.amount = liqAmount;
        liq.price = liq.price || computedLiqPrice;
        liq.bankruptcyPrice = liq.bankruptcyPrice || computedLiqPrice;

        const bankruptcyPrice = liq.bankruptcyPrice;
        const isSell = liq.sell;

        //------------------------------------------------------------
        // 4. Estimate book fill BEFORE inserting order
        //------------------------------------------------------------
        const splat = await orderbook.estimateLiquidation(liq, notional, inverse);
        console.log("🔎 estimateLiquidation →", splat);

        const canFillSolvently =
            splat.goodFilledSize > 0 &&
            !splat.filledBelowLiqPrice;

        const A = new Big(tallySnapshot.available || 0);
        const M = new Big(tallySnapshot.margin || 0);
        const maint = M.div(2);

        // shortfall passed in as marginDent
        const shortfallBN = new Big(marginDent);

        // coverage = available + maintenance margin
        const coverageBN = A.plus(maint);

        // FIXED: loss = coverage + shortfall, but we can only distribute what we have
        let lossBN = coverageBN.plus(shortfallBN);

        // ------------------------------------------------------------
        // COMPUTE REAL MARGIN DENT (bounded by margin)
        // ------------------------------------------------------------
        const lossFromAvail = Big.min(lossBN, A);
        const remainingLoss = lossBN.minus(lossFromAvail);

        // dent = portion of remainingLoss sourced from margin (bounded by maint)
        let dentBN = Big.min(remainingLoss, maint);

        // enforce invariant
        if (dentBN.gt(M)) {
            console.log(`⚠️ dent capped: ${dentBN.toString()} > margin ${M.toString()}`);
            dentBN = M;
        }

        // ------------------------------------------------------------
        // 6. Attempt OB matching
        // ------------------------------------------------------------
        let obFill = new Big(0);

        if (canFillSolvently) {
            const obKey = contractId.toString();
            let obData = orderbook.orderBooks[obKey] || { buy: [], sell: [] };

            obData = await orderbook.insertOrder(liq, obData, liq.sell, true);

            const matchResult = await orderbook.matchContractOrders(obData);

            if (matchResult.matches.length > 0) {
                await orderbook.processContractMatches(matchResult.matches, blockHeight, false);
            }

            await orderbook.saveOrderBook(matchResult.orderBook, obKey);

            obFill = new Big(splat.goodFilledSize);
        }

        // ------------------------------------------------------------
        // 7. Determine ADL remainder
        // ------------------------------------------------------------
        const adlSize = new Big(liqAmount).minus(obFill);
        const remainder = adlSize.gt(0) ? adlSize.toNumber() : 0;

        // ------------------------------------------------------------
        // 8. Calculate liquidation pool BEFORE confiscation
        // FIXED: Pool is what's actually available, not computed loss
        // ------------------------------------------------------------
        const liqTally = await Tally.getTally(liquidatingAddress, collateralId);

        const liquidationPool = new Big(liqTally.margin || 0)
            .plus(liqTally.available || 0)
            .dp(8)
            .toNumber();

        // ------------------------------------------------------------
        // 9. Confiscate liquidation pool
        // ------------------------------------------------------------
        if (liquidationPool > 0) {
            await Tally.updateBalance(
                liquidatingAddress,
                collateralId,
                -(liqTally.available || 0),
                0,
                -(liqTally.margin || 0),
                0,
                'liquidationPoolDebit',
                blockHeight
            );
        }

        // ------------------------------------------------------------
        // 10. Systemic loss - FIXED: Use actual shortfall vs pool
        // ------------------------------------------------------------
        let systemicLoss = new Big(0);

        // The systemic loss is what we couldn't cover from the pool
        const totalLossNeeded = lossBN;
        const poolAvailable = new Big(liquidationPool);

        if (totalLossNeeded.gt(poolAvailable)) {
            systemicLoss = totalLossNeeded.minus(poolAvailable).dp(8);
        }

        // ------------------------------------------------------------
        // 11. Apply ADL if needed - pass actual pool amount
        // ------------------------------------------------------------
        let result = { counterparties: [], poolAssignments: [] };

        if (remainder > 0) {
            result = await marginMap.simpleDeleverage(
                positionCache,
                contractId,
                remainder,
                isSell,
                bankruptcyPrice,  // Use computed bankruptcy price
                liquidatingAddress,
                inverse,
                notional,
                blockHeight,
                markPrice,
                collateralId,
                liquidationPool  // FIXED: Pass actual available pool
            );
        }

        // ------------------------------------------------------------
        // 12. Apply pool credits from ADL - CAPPED at pool
        // ------------------------------------------------------------
        for (const u of (result.poolAssignments || [])) {
            // CRITICAL: Don't distribute more than the pool has
            const creditAmount = Math.min(u.poolShare, liquidationPool);
            if (creditAmount > 0) {
                await Tally.updateBalance(
                    u.address,
                    collateralId,
                    creditAmount,
                    0, 0, 0,
                    'deleveragePoolCredit',
                    blockHeight
                );
            }
        }

        //------------------------------------------------------------
        // 13. Apply CP position updates
        //------------------------------------------------------------
        for (const cp of (result.counterparties || [])) {
            Clearing.updatePositionInCache(ctxKey, cp.address, () => ({ ...cp.updatedPosition }));
            Clearing.recordDeleverageTrade(contractId,cp.address,cp)
        }

        //------------------------------------------------------------
        // 14. Zero out liquidated position
        //------------------------------------------------------------
        Clearing.updatePositionInCache(ctxKey, liquidatingAddress, old => ({
            ...old,
            contracts: 0,
            margin: 0,
            unrealizedPNL: 0,
            averagePrice: null,
            bankruptcyPrice: null,
            lastMark: markPrice
        }));


        //------------------------------------------------------------
        // 15. Return summary
        //------------------------------------------------------------
        return {
            liquidation: liq,
            systemicLoss: systemicLoss.toNumber(),
            counterparties: result.counterparties || []
        };
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

    /**
     * Settle all options expiring at or before currentBlock for a given series.
     * Intrinsic only (European-style cash). Premium MTM is for equity/liq calcs only.
     */
    static async settleOptionExpiries(seriesId, currentBlockHeight, spot, blocksPerDay, txid) {
      const mm = await MarginMap.getInstance(seriesId);
      const seriesInfo = await ContractRegistry.getContractInfo(seriesId);
      if (!seriesInfo) return;
      const collateralPropertyId = seriesInfo.collateralPropertyId;

      const expTickers = await mm.getExpiringTickersUpTo(currentBlockHeight);
      if (!expTickers.length) return;

      // For each address with positions
      for (const [address, pos] of mm.margins.entries()) {
        if (!pos || !pos.options) continue;

        for (const ticker of expTickers) {
          const optPos = pos.options[ticker];
          if (!optPos) continue;

          const qty = Number(optPos.contracts || 0);
          if (!qty) {
            // remove the empty slot to keep map clean
            delete pos.options[ticker];
            continue;
          }

          const meta = Options.parseTicker(ticker);
          if (!meta) continue;

          // Intrinsic payoff at settlement
          const iv = Options.intrinsic(meta.type, Number(meta.strike || 0), Number(spot || 0));
          const cash = iv * Math.abs(qty); // per-contract * absolute qty

          // Long options receive; short options pay
          const availableDelta = qty > 0 ? +cash : -cash;

          // Free any margin previously held on this option leg
          const marginHeld = Number(optPos.margin || 0);
          const marginDelta = marginHeld ? -marginHeld : 0;

          // Tally: available +/- intrinsic; margin -= marginHeld
          await TallyMap.updateBalance(
            address,
            collateralPropertyId,
            availableDelta, // availableChange
            0,              // reservedChange
            marginDelta,    // marginChange
            0,              // vestingChange
            'optionExpire',
            currentBlockHeight,
            txid
          );

          // Remove the option sub-position from the blob
          delete pos.options[ticker];

          // Record margin map delta
          await mm.recordMarginMapDelta(
            address,
            ticker,
            0,                 // position after (expired → closed)
            -qty,              // delta contracts to flat
            iv,                // settled at intrinsic (for audit)
            0,                 // uPNL delta
            marginHeld ? -marginHeld : 0, // margin freed
            'optionExpire',
            currentBlockHeight
          );
        }

        // Save back the mutated blob
        mm.margins.set(address, pos);
      }

      // Global index cleanup (remove those expiries)
      await mm.cleanupExpiredTickersUpTo(currentBlockHeight);
    }

    static getLatestPositionByAddress(trades, address) {
      // Loop backwards since later trades are more recent
      for (let i = trades.length - 1; i >= 0; i--) {
        const trade = trades[i];
        // Check buyerPosition first
        if (trade.buyerPosition && trade.buyerPosition.address === address) {
          return trade.buyerPosition;
        }
        // Check sellerPosition
        if (trade.sellerPosition && trade.sellerPosition.address === address) {
          return trade.sellerPosition;
        }
      }
      // If no matching position is found, return null
      return null;
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

    // clearingPnL.js (or inside clearing.js)

    static calculateClearingPNL({
        oldContracts,
        previousMarkPrice,
        currentMarkPrice,
        inverse,
        notional
    }) {
        const BigNumber = require('bignumber.js');

        const size = new BigNumber(oldContracts || 0);
        if (size.isZero()) return new BigNumber(0);

        const last = new BigNumber(previousMarkPrice || 0);
        const cur  = new BigNumber(
            currentMarkPrice != null ? currentMarkPrice : previousMarkPrice || 0
        );

        // no mark movement → no clearing PnL
        if (last.eq(cur)) return new BigNumber(0);

        const noto = new BigNumber(notional || 1);
        let pnl;

        if (!inverse) {
            // linear
            pnl = size
                .times(cur.minus(last))
                .times(noto);
        } else {
            // inverse
            if (last.isZero() || cur.isZero()) return new BigNumber(0);

            pnl = size
                .times(
                    new BigNumber(1).div(last)
                        .minus(new BigNumber(1).div(cur))
                )
                .times(noto);
        }

        return pnl.isFinite() ? pnl : new BigNumber(0);
    }

    // newContractPnL.js
    static calculateNewContractPNL({
        newContracts,
        avgEntryPrice,
        lastPrice,
        inverse,
        notional
    }) {
        const BigNumber = require('bignumber.js');

        const size = new BigNumber(newContracts || 0);
        if (size.isZero()) return new BigNumber(0);

        const avg  = new BigNumber(avgEntryPrice || 0);
        const exec = new BigNumber(lastPrice || 0);
        if (avg.isZero() || exec.eq(avg)) return new BigNumber(0);

        const noto = new BigNumber(notional || 1);
        let pnl;

        if (!inverse) {
            pnl = size
                .times(exec.minus(avg))
                .times(noto);
        } else {
            pnl = size
                .times(
                    new BigNumber(1).div(avg)
                        .minus(new BigNumber(1).div(exec))
                )
                .times(noto);
        }

        return pnl.isFinite() ? pnl : new BigNumber(0);
    }

    static async getBalance(holderAddress) {
        // Replace this with actual data fetching logic for your system
        try {
            let balance = await database.getBalance(holderAddress);
            return balance;
        } catch (error) {
            console.error('Error fetching balance for address:', holderAddress, error);
            //throw error;
        }
    }

    static async performAdditionalSettlementTasks(blockHeight,positions, contractId, mark,totalLoss,collateralId,pnlDelta){        
            if (pnlDelta.gt(0)) {
                // ✅ POSITIVE delta: cover it from IOU credit / insurance / fee cache
                // Here we *do not* touch individual traders; we just reflect the mismatch
                // into a central sink, e.g. "insurance" address or PnlIou bucket.
                await PnlIou.applyToLosers(contractId,pnlDelta,blockHeight,collateralId);
            } else if(pnlDelta.lt(0)){
                // NEGATIVE delta: extra loss — treat as insurance accrual / reserve top-up
                await PnlIou.payOutstandingIous(contractId, collateralId, pnlDelta, blockHeight);
            }

       //try {
                // Step 2: Check if insurance fund payout is needed
                console.log('total loss for '+contractId+' '+totalLoss.toNumber())
        if (totalLoss.abs().gt(0)) {
            const ContractRegistry = require('./contractRegistry.js');
            const isOracleContract = await ContractRegistry.isOracleContract(contractId);
            const insurance = await Insurance.getInstance(contractId, isOracleContract);

            const payout = await insurance.calcPayout(totalLoss.abs(), blockHeight);
            console.log('payout to distribute '+payout)
            if (payout>0) {
                await Clearing.distributeInsuranceProRataToDelev(
                    contractId,
                    collateralId,
                    payout,        // ✅ PASS PAYOUT, NOT totalLoss
                    blockHeight
                );
            }

            const remainingLoss = totalLoss.minus(payout);
            console.log('remaining loss ' + remainingLoss);
        }


        //} catch (error) {
        //    console.error('Error performing additional settlement tasks:', error);
        //    throw error;
        //}
    }

    // -------------------------
    // INSURANCE RESOLUTION HELPERS
    // -------------------------
    static async resolveInsuranceMeta(tradingContractId) {
        const ContractRegistry = require('./contractRegistry.js');

        // For now: fund is keyed by same contractId,
        // but type is determined by registry (drives -oracle storage behavior).
        const isOracle = await ContractRegistry.isOracleContract(tradingContractId);
        const insuranceContractId = tradingContractId;

        return { insuranceContractId, isOracle };
    }

    static async distributeInsuranceProRataToDelev(
        tradingContractId,
        collateralId,
        payout,        // NUMBER
        blockHeight
    ) {
        const BigNumber = require('bignumber.js');
        const Tally = require('./tally.js');
        const PnlIou = require('./iou.js');

        if (!payout || payout <= 0) return;

        const payoutBN = new BigNumber(payout);

        let totalContracts = new BigNumber(0);

        for (const [key, trades] of Clearing.deleverageTrades.entries()) {
            if (!key.startsWith(`${tradingContractId}:`)) continue;
            for (const t of trades) {
                totalContracts = totalContracts.plus(t.matchSize || 0);
            }
        }

        if (totalContracts.lte(0)) return;

        let distributed = new BigNumber(0);

        for (const [key, trades] of Clearing.deleverageTrades.entries()) {
            if (!key.startsWith(`${tradingContractId}:`)) continue;

            const address = key.split(':')[1];

            let addressContracts = new BigNumber(0);
            for (const t of trades) {
                addressContracts = addressContracts.plus(t.matchSize || 0);
            }

            if (addressContracts.lte(0)) continue;

            const share = payoutBN.times(addressContracts).div(totalContracts);

            if (share.lte(0)) continue;

            await Tally.updateBalance(
                address,
                collateralId,
                share,          // availableChange (+)
                0,              // reservedChange
                0,              // marginChange
                0,              // vestingChange
                'insuranceDelev',
                blockHeight,
                ''              // txid (synthetic / none)
            );


            distributed = distributed.plus(share);
        }

        const dust = payoutBN.minus(distributed);
        if (dust.abs().gt(0)) {
            await PnlIou.absorbDust(
                tradingContractId,
                collateralId,
                dust,
                blockHeight
            );
        }
    }

    /**
     * Summarize options for an address under a given series (for liquidation offsets).
     * Returns:
     *   {
     *     premiumMTM,   // mark-to-model value of options (can be +/-) at current spot
     *     intrinsicNet, // net intrinsic (>=0 longs, <=0 shorts aggregated)
     *     maintNaked    // maintenance add-on for naked shorts (padding for triggers)
     *   }
     */
    async computeOptionAdjustments(seriesId, address, spot, currentBlockHeight, blocksPerDay) {
      const mm = await MarginMap.getInstance(seriesId);
      const pos = mm.margins.get(address) || {};
      const optionsBag = pos.options || {};
      const seriesInfo = await ContractRegistry.getContractInfo(seriesId);
      // If you store a vol index on the series, grab it; else fallback conservatively
      const volAnnual = Number(seriesInfo?.volAnnual || 0); // e.g. 0.6 means 60% annualized
      const bpd = Math.max(1, Number(blocksPerDay || 144));
      let premiumMTM = 0;
      let intrinsicNet = 0;
      let maintNaked = 0;

      for (const [ticker, o] of Object.entries(optionsBag)) {
        const meta = Options.parseTicker(ticker);
        if (!meta) continue;

        const blocksToExp = Math.max(0, Number(meta.expiryBlock || 0) - Number(currentBlockHeight || 0));
        const daysToExpiry = blocksToExp / bpd;

        // qty is signed: >0 long options, <0 short options
        const qty = Number(o.contracts || 0);
        if (!qty) continue;

        // MTM premium approximation (treating options as assets for equity)
        const px = Options.priceEUApprox(meta.type, Number(spot || 0), Number(meta.strike || 0), volAnnual, daysToExpiry);
        premiumMTM += px * qty;

        // Intrinsic (floor/ceiling) can be used as an extra conservative cushion
        const iv = Options.intrinsic(meta.type, Number(meta.strike || 0), Number(spot || 0));
        intrinsicNet += iv * qty;

        // Naked maintenance padding for shorts only (10× rule via helper)
        if (qty < 0) {
          maintNaked += Options.nakedMaintenance(meta.type, Number(meta.strike || 0), Number(spot || 0)) * Math.abs(qty);
        }
      }

      return { premiumMTM, intrinsicNet, maintNaked };
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
            //throw error;
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
            //throw error;
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

     static async saveFundingEvent(contractId, fundingRate, blockHeight) {
        try {
            const fundingDB = await db.getDatabase('fundingEvents');

            const event = {
                _id: `funding-${contractId}-${blockHeight}`,
                contractId,
                fundingRate,
                blockHeight,
                timestamp: new Date().toISOString()
            };

            await fundingDB.updateAsync({ _id: event._id }, event, { upsert: true });

            console.log(`✅ [Funding Event Saved] Contract: ${contractId}, Block: ${blockHeight}, Rate: ${fundingRate} bps`);
        } catch (error) {
            console.error(`❌ Error saving funding event for contract ${contractId}:`, error);
        }
    }

    static async loadFundingEvents(contractId, startBlock, endBlock) {
        try {
            const fundingDB = await db.getDatabase('fundingEvents');

            const query = {
                contractId: contractId,
                blockHeight: { $gte: startBlock, $lte: endBlock }
            };

            return await fundingDB.findAsync(query);
        } catch (error) {
            console.error(`❌ Error loading funding events:`, error);
            return [];
        }
    }
    // Additional helper methods or logic as required
}

module.exports = Clearing;