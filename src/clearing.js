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
    static recordTrade(contractId, address, opened, closed, price, txid, isBuyer) {
      const key = `${contractId}:${address}`;
      const entry = this._ensureBlockTradeEntry(key);

      const BigNumber = require('bignumber.js');

      const px = new BigNumber(price || 0);
      const openedAbs = new BigNumber(Math.abs(opened || 0));
      const closedAbs = new BigNumber(Math.abs(closed || 0));

      // ------------------------------------------------------------
      // Signed opened quantity (CRITICAL)
      // Buyer  => +opened
      // Seller => -opened
      // ------------------------------------------------------------
      const signedOpened = isBuyer
        ? openedAbs
        : openedAbs.negated();

      // ------------------------------------------------------------
      // Same-block pools (avg-cost accounting)
      // ------------------------------------------------------------
      const openPool  = isBuyer ? entry.pools.long  : entry.pools.short;
      const closePool = isBuyer ? entry.pools.short : entry.pools.long;

      const openedBefore = openPool.qty.toNumber();

      // ------------------------------------------------------------
      // Add opens to the correct side pool
      // ------------------------------------------------------------
      if (openedAbs.gt(0)) {
        openPool.qty  = openPool.qty.plus(openedAbs);
        openPool.cost = openPool.cost.plus(openedAbs.multipliedBy(px));
      }

      // ------------------------------------------------------------
      // Consume closes from opposite side pool (same-block closes)
      // ------------------------------------------------------------
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

      // ------------------------------------------------------------
      // Trade object (SIGNED opened)
      // ------------------------------------------------------------
      const tradeObj = {
        opened: signedOpened.toNumber(),     // ✅ SIGNED
        closed: closedAbs.toNumber(),
        consumedFromOpened: consumedFromOpened.toNumber(),
        price: px.toNumber(),
        openedBefore,
        consumedAvgPrice,
        txid
      };

      entry.trades.push(tradeObj);

      // Keep openedSoFar meaningful for any legacy readers
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

    static computeOpenedRemainderFromTrades(trades) {
      const BigNumber = require('bignumber.js');

      let openedSigned = new BigNumber(0);   // signed remainder since mark
      let openedCostAbs = new BigNumber(0);  // cost basis of remainder: sum(abs(open) * openPrice)

      for (const t of trades || []) {
        const px = new BigNumber(t?.price || 0);
        if (px.lte(0)) continue;

        const openSigned = new BigNumber(t?.opened || 0);    // signed
        const closeAbs   = new BigNumber(t?.closed || 0).abs(); // abs

        // 1) consume closes against the remainder FIRST (only up to remainder)
        if (!closeAbs.isZero() && !openedSigned.isZero()) {
          const remAbs = openedSigned.abs();
          const consumeAbs = BigNumber.minimum(closeAbs, remAbs);

          if (consumeAbs.gt(0)) {
            // remove cost at CURRENT avg open cost, NOT at close price
            const avgOpenCost = remAbs.gt(0) ? openedCostAbs.div(remAbs) : new BigNumber(0);
            openedCostAbs = openedCostAbs.minus(consumeAbs.times(avgOpenCost));

            // shrink signed remainder toward 0
            const sgn = openedSigned.isNegative() ? -1 : 1;
            openedSigned = openedSigned.minus(consumeAbs.times(sgn));
          }
        }

        // 2) add new opens (signed)
        if (!openSigned.isZero()) {
          openedSigned = openedSigned.plus(openSigned);
          openedCostAbs = openedCostAbs.plus(openSigned.abs().times(px));
        }
      }

      const remAbs = openedSigned.abs();
      const avg = remAbs.gt(0) ? openedCostAbs.div(remAbs) : null;

      return {
        openedSigned: openedSigned.toNumber(),
        openedAvg: avg ? avg.toNumber() : null
      };
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
      
      // Convert Map to Array if needed
      let posArray;
      if (positions instanceof Map) {
          posArray = Array.from(positions.values());
      } else if (Array.isArray(positions)) {
          posArray = positions;
      } else {
          posArray = [];
      }
      
      // Deep clone so nobody mutates marginMap's internal structures
      const cloned = JSON.parse(JSON.stringify(posArray));
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

    static addOrUpdatePositionInCache(ctxKey, address, position) {
        const ctx = _positionCache.get(ctxKey);
        if (!ctx) throw new Error(`No clearing context for ${ctxKey}`);
        const positions = ctx.positions;

        const idx = positions.findIndex(p => p.address === address);
        if (idx === -1) {
          // Add new position
          positions.push({ ...position });
          console.log(`[CACHE] Added new position for ${address}`);
        } else {
          // Update existing
          positions[idx] = { ...position };
        }
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

    static async settleLiqNewContractsFromDB(contractId, blockHeight, lastPrice, ctxKey, preTradePositions) {
        const BigNumber = require('bignumber.js');
        const Tally = require('./tally.js');
        const ContractRegistry = require('./contractRegistry.js');
        
        const trades = await TradeHistory.getLiquidationTradesForContractAtBlock(contractId, blockHeight);
        console.log('trades in settleLiqNewContractsFromDB ' + JSON.stringify(trades));
        
        const refPrice = lastPrice;
        const collateralId = await ContractRegistry.getCollateralId(contractId);
        const inverse = await ContractRegistry.isInverse(contractId);
        const notionalObj = await ContractRegistry.getNotionalValue(contractId, refPrice);
        const notional = notionalObj?.notionalPerContract ?? notionalObj ?? 1;
        
        if (!trades?.length) return;
        
        const Clearing = this;
        const cachedPositions = preTradePositions || Clearing.getPositionsFromCache(ctxKey);
        
        const positionDeltas = new Map();
        
        for (const trade of trades) {
          const entryPrice = Number(trade.price);
          if (!entryPrice || entryPrice <= 0) continue;
          const amount = Number(trade.amount);
          
          // ---------- BUYER side ----------
          const buyerAddr = trade.buyerAddress;
          
          let buyerContractsBefore;
          if (positionDeltas.has(buyerAddr)) {
            buyerContractsBefore = positionDeltas.get(buyerAddr);
          } else {
            const buyerCachedPos = cachedPositions.find(p => p.address === buyerAddr);
            buyerContractsBefore = buyerCachedPos?.contracts || 0;
          }
          
          const buyerContractsAfter = buyerContractsBefore + amount;
          positionDeltas.set(buyerAddr, buyerContractsAfter);
          
          const buyerClose = buyerContractsBefore < 0 
            ? Math.min(amount, Math.abs(buyerContractsBefore)) 
            : 0;
          const buyerOpened = amount - buyerClose;
          
          console.log(`BUYER ${buyerAddr.slice(-8)}: before=${buyerContractsBefore} after=${buyerContractsAfter} close=${buyerClose} opened=${buyerOpened}`);
          
          if (buyerOpened > 0) {
            let pnl;
            if (!inverse) {
              pnl = buyerOpened * notional * (refPrice - entryPrice);
            } else {
              pnl = buyerOpened * notional * ((1 / entryPrice) - (1 / refPrice));
            }
            console.log(`BUYER ${buyerAddr.slice(-8)} pnl=${pnl}`);
            if (pnl !== 0) {
              await Tally.updateBalance(
                buyerAddr,
                collateralId,
                pnl,
                0,
                0,
                0,
                'liqNewContractTieOff',
                blockHeight
              );
            }
          }
          
          // ---------- SELLER side ----------
          const sellerAddr = trade.sellerAddress;
          
          let sellerContractsBefore;
          if (positionDeltas.has(sellerAddr)) {
            sellerContractsBefore = positionDeltas.get(sellerAddr);
          } else {
            const sellerCachedPos = cachedPositions.find(p => p.address === sellerAddr);
            sellerContractsBefore = sellerCachedPos?.contracts || 0;
          }
          
          const sellerContractsAfter = sellerContractsBefore - amount;
          positionDeltas.set(sellerAddr, sellerContractsAfter);
          
          const sellerClose = sellerContractsBefore > 0
            ? Math.min(amount, sellerContractsBefore)
            : 0;
          const sellerOpened = amount - sellerClose;
          
          console.log(`SELLER ${sellerAddr.slice(-8)}: before=${sellerContractsBefore} after=${sellerContractsAfter} close=${sellerClose} opened=${sellerOpened}`);
          
          if (sellerOpened > 0) {
            let pnl;
            if (!inverse) {
              pnl = -sellerOpened * notional * (refPrice - entryPrice);
            } else {
              pnl = -sellerOpened * notional * ((1 / entryPrice) - (1 / refPrice));
            }
            console.log(`SELLER ${sellerAddr.slice(-8)} pnl=${pnl}`);
            if (pnl !== 0) {
              await Tally.updateBalance(
                sellerAddr,
                collateralId,
                pnl,
                0,
                0,
                0,
                'liqNewContractTieOff',
                blockHeight
              );
            }
          }
        }
      }
    
    static async settleNewContracts(contractId, blockHeight, priceInfo) {
      const BigNumber = require('bignumber.js');
      const Tally = require('./tally.js');
      const ContractRegistry = require('./contractRegistry.js');
      const TradeHistoryManager = require('./tradeHistoryManager.js');
      
      const refPrice = priceInfo?.lastPrice ?? null;
      if (refPrice == null) return;
      
      const collateralId = await ContractRegistry.getCollateralId(contractId);
      const inverse = await ContractRegistry.isInverse(contractId);
      const notionalObj = await ContractRegistry.getNotionalValue(contractId, refPrice);
      const notional = notionalObj?.notionalPerContract ?? notionalObj ?? 1;
      
      // --------------------------------------------------------
      // Fetch actual trade records for this block
      // --------------------------------------------------------
      const trades = await TradeHistoryManager.getTradesForContractBetweenBlocks(contractId, blockHeight, blockHeight);
      
      if (!trades || trades.length === 0) {
        console.log(`[settleNewContracts] No trades for contract ${contractId} at block ${blockHeight}`);
        return;
      }
      
      console.log(`[settleNewContracts] Processing ${trades.length} trades for contract ${contractId}`);
      
      // --------------------------------------------------------
      // First pass: collect opens and closes per address
      // We need to track same-block netting properly
      // --------------------------------------------------------
      // Structure: address -> { 
      //   longOpens: [{qty, price}], shortOpens: [{qty, price}],
      //   longCloses: number, shortCloses: number 
      // }
      const addressData = new Map();
      
      function getOrCreate(addr) {
        if (!addressData.has(addr)) {
          addressData.set(addr, { 
            longOpens: [], 
            shortOpens: [], 
            longCloses: 0, 
            shortCloses: 0 
          });
        }
        return addressData.get(addr);
      }
      
      for (const trade of trades) {
        const { buyerAddress, sellerAddress, amount, price, buyerClose, sellerClose } = trade;
        
        // Buyer side
        const buyerData = getOrCreate(buyerAddress);
        const buyerOpened = amount - (buyerClose || 0);
        const buyerClosed = buyerClose || 0;
        
        if (buyerOpened > 0) {
          // Buyer opens LONG
          buyerData.longOpens.push({ qty: buyerOpened, price });
        }
        if (buyerClosed > 0) {
          // Buyer closing means they had SHORT before
          buyerData.shortCloses += buyerClosed;
        }
        
        // Seller side
        const sellerData = getOrCreate(sellerAddress);
        const sellerOpened = amount - (sellerClose || 0);
        const sellerClosed = sellerClose || 0;
        
        if (sellerOpened > 0) {
          // Seller opens SHORT
          sellerData.shortOpens.push({ qty: sellerOpened, price });
        }
        if (sellerClosed > 0) {
          // Seller closing means they had LONG before
          sellerData.longCloses += sellerClosed;
        }
      }
      
      // --------------------------------------------------------
      // Second pass: calculate tie-off PnL with same-block netting
      // Opens within same block can be netted against closes
      // --------------------------------------------------------
      const pnlByAddress = new Map();
      
      for (const [address, data] of addressData.entries()) {
        const { longOpens, shortOpens, longCloses, shortCloses } = data;
        
        // Process LONG opens (netted against shortCloses if any same-block close of longs happened)
        // Wait - longCloses means closing longs (selling), shortCloses means closing shorts (buying)
        // If someone opens long AND closes short in same block, those don't net
        // If someone opens short AND closes that short in same block, THOSE net
        
        // Actually: shortCloses = closing shorts by buying = person was short, now buying
        //           longCloses = closing longs by selling = person was long, now selling
        // 
        // If in same block you OPEN SHORT then CLOSE SHORT:
        //   shortOpens has qty, shortCloses has qty -> they net
        // If in same block you OPEN LONG then CLOSE LONG:
        //   longOpens has qty, longCloses has qty -> they net
        
        // Net long opens = sum(longOpens.qty) - longCloses (can't be negative)
        let totalLongOpened = 0;
        for (const o of longOpens) totalLongOpened += o.qty;
        const netLongOpened = Math.max(0, totalLongOpened - longCloses);
        
        // Net short opens = sum(shortOpens.qty) - shortCloses (can't be negative)
        let totalShortOpened = 0;
        for (const o of shortOpens) totalShortOpened += o.qty;
        const netShortOpened = Math.max(0, totalShortOpened - shortCloses);
        
        console.log(`[settleNewContracts] ${address}: longOpened=${totalLongOpened} longCloses=${longCloses} -> netLong=${netLongOpened}`);
        console.log(`[settleNewContracts] ${address}: shortOpened=${totalShortOpened} shortCloses=${shortCloses} -> netShort=${netShortOpened}`);
        
        let totalPnl = new BigNumber(0);
        
        // Tie-off net LONG opens (FIFO: consume from earliest opens first for closes)
        if (netLongOpened > 0 && longOpens.length > 0) {
          // Skip the first `longCloses` worth of opens (they were closed same-block)
          let remaining = netLongOpened;
          let skipped = longCloses;
          
          for (const o of longOpens) {
            if (skipped >= o.qty) {
              skipped -= o.qty;
              continue;
            }
            const useQty = Math.min(remaining, o.qty - skipped);
            skipped = 0;
            
            if (useQty > 0) {
              let pnl;
              if (inverse) {
                const invEntry = new BigNumber(1).div(o.price);
                const invRef = new BigNumber(1).div(refPrice);
                pnl = new BigNumber(useQty).times(notional).times(invEntry.minus(invRef));
              } else {
                pnl = new BigNumber(useQty).times(notional).times(
                  new BigNumber(refPrice).minus(o.price)
                );
              }
              totalPnl = totalPnl.plus(pnl);
              console.log(`[settleNewContracts] ${address} LONG ${useQty} @ ${o.price} -> pnl=${pnl.toFixed()}`);
              remaining -= useQty;
            }
            if (remaining <= 0) break;
          }
        }
        
        // Tie-off net SHORT opens
        if (netShortOpened > 0 && shortOpens.length > 0) {
          let remaining = netShortOpened;
          let skipped = shortCloses;
          
          for (const o of shortOpens) {
            if (skipped >= o.qty) {
              skipped -= o.qty;
              continue;
            }
            const useQty = Math.min(remaining, o.qty - skipped);
            skipped = 0;
            
            if (useQty > 0) {
              let pnl;
              if (inverse) {
                const invEntry = new BigNumber(1).div(o.price);
                const invRef = new BigNumber(1).div(refPrice);
                pnl = new BigNumber(useQty).times(notional).times(invRef.minus(invEntry));
              } else {
                pnl = new BigNumber(useQty).times(notional).times(
                  new BigNumber(o.price).minus(refPrice)
                );
              }
              totalPnl = totalPnl.plus(pnl);
              console.log(`[settleNewContracts] ${address} SHORT ${useQty} @ ${o.price} -> pnl=${pnl.toFixed()}`);
              remaining -= useQty;
            }
            if (remaining <= 0) break;
          }
        }
        
        if (!totalPnl.isZero()) {
          pnlByAddress.set(address, totalPnl);
        }
      }
      
      // --------------------------------------------------------
      // Apply PnL to each address
      // --------------------------------------------------------
      for (const [address, pnlBN] of pnlByAddress.entries()) {
        console.log(`[settleNewContracts] ${address} total PnL=${pnlBN.toFixed()}`);
        
        const tally = await Tally.getTally(address, collateralId);
        const avail = new BigNumber(tally?.available ?? 0);
        const mar = new BigNumber(tally?.margin ?? 0);
        
        let availCh = new BigNumber(0);
        let marCh = new BigNumber(0);
        
        if (pnlBN.gt(0)) {
          availCh = pnlBN;
        } else {
          const loss = pnlBN.abs();
          if (avail.gte(loss)) {
            availCh = loss.negated();
          } else {
            const takeAvail = avail;
            const remaining = loss.minus(takeAvail);
            if (mar.gte(remaining)) {
              availCh = takeAvail.negated();
              marCh = remaining.negated();
            } else {
              availCh = takeAvail.negated();
              marCh = mar.negated();
              console.error(`[settleNewContracts] BAD DEBT: ${address} owes ${remaining.minus(mar).toFixed()}`);
            }
          }
        }
        
        if (!availCh.isZero() || !marCh.isZero()) {
          await Tally.updateBalance(
            address,
            collateralId,
            availCh.toNumber(),
            0,
            marCh.toNumber(),
            0,
            'newContractTieOff',
            blockHeight
          );
        }
      }
    }
    // orderbook.js
    static async pruneInstaLiqOrders(thisPrice, blockHeight,contractId) {
      const Tally = require('./tally.js');
      const ContractRegistry = require('./contractRegistry.js');

      const inverse = await ContractRegistry.isInverse(contractId);

      const notionalObj =
        await ContractRegistry.getNotionalValue(contractId, thisPrice);
      const notional =
        notionalObj?.notionalPerContract ?? notionalObj ?? 1;

        // ✅ delegate after notional stuff populates
        const Orderbook = require('./orderbook.js')
        const ob = await Orderbook.getOrderbookInstance(contractId)
        return await ob._pruneInstaLiqOrdersFromFreshBook(
          thisPrice,
          blockHeight,
          contractId,
          notional,
          inverse
        );
    }


    static async makeSettlement(blockHeight) {
        const ContractRegistry = require('./contractRegistry.js');
        const contracts = await ContractRegistry.loadContractSeries();
        if (!contracts) return;

        for (const contract of contracts) {
            const id = contract[1].id;
            const priceInfo = await Clearing.isPriceUpdatedForBlockHeight(id, blockHeight);
            console.log('price info '+JSON.stringify(priceInfo))
            await Clearing.pruneInstaLiqOrders(priceInfo.thisPrice, blockHeight,id)
            await Clearing.settleNewContracts(id,blockHeight,priceInfo)
            const collateralId = await ContractRegistry.getCollateralId(id);
            await Clearing.settleIousForBlock(
                id,
                collateralId,
                blockHeight
            );

            if (!priceInfo || !priceInfo.updated) continue;

            const newPrice = priceInfo.thisPrice;
            console.log('new price ' + newPrice);
            console.log('Making settlement for positions at block height:', JSON.stringify(contract) + ' ' + blockHeight);

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

    static consensusAddressSort(a, b) {
        if (a === b) return 0;
        return a < b ? -1 : 1;
    }

    static async updateMarginMaps(blockHeight, contractId, collateralId, inverse, notional, priceInfo) {
      console.log(`\n================ UPDATE MARGIN MAPS ================`);
      console.log(`contract=${contractId} block=${blockHeight}`);
      console.log(`====================================================`);

      const MarginMap = require('./marginMap.js');
      const Orderbook = require('./orderbook.js');
      const Tally     = require('./tally.js');
      const BigNumber = require('bignumber.js');

      const marginMap = await MarginMap.getInstance(contractId);

      // ------------------------------------------------------------
      // 1) Load positions
      // ------------------------------------------------------------
      const rawPositions = await marginMap.getAllPositions(contractId);
      console.log('JSON of positions starting clearing '+JSON.stringify(rawPositions))
      //if(blockHeight==4494797){throw new Error()}
      console.log(`[LOAD] rawPositions.size=${rawPositions?.size}`);
      const ctxKey = Clearing.initPositionCache(contractId, blockHeight, rawPositions);
      console.log(`[CACHE] initPositionCache ctxKey=${ctxKey}`);

      let positions = Clearing.getPositionsFromCache(ctxKey);
      console.log(`[CACHE] positions.length=${Array.isArray(positions) ? positions.length : 'NOT ARRAY'}`);
      console.log('positions before final '+JSON.stringify(positions))
      if (!Array.isArray(positions) || positions.length === 0) {

        console.log('[EXIT] no positions');
        Clearing.flushPositionCache(ctxKey);
        return { positions: [], liqEvents: [], systemicLoss: new BigNumber(0), pnlDelta: new BigNumber(0) };
      }


      // ------------------------------------------------------------
      // 2) Resolve mark prices (use priceInfo, not blob)
      // ------------------------------------------------------------
      console.log(`[PRICE] provided priceInfo`, priceInfo);

      const lastPrice = new BigNumber(
        priceInfo?.lastPrice ??
        0
      );

      let thisPrice = new BigNumber(
        priceInfo?.thisPrice ??
        0
      );

      console.log(`[PRICE] last=${lastPrice.toFixed()} this=${thisPrice.toFixed()}`);

      if (!lastPrice.gt(0)) {
        console.log('[EXIT] no lastPrice');
        const finalPositions = Clearing.flushPositionCache(ctxKey);
        console.log('final positions '+JSON.stringify(finalPositions))
        await marginMap.mergePositions(finalPositions, contractId, true);
        return { positions, liqEvents: [], systemicLoss: new BigNumber(0), pnlDelta: new BigNumber(0) };
      }

      // If we didn't get a fresh mark for "this", settle using lastPrice for this block
      if (!thisPrice.gt(0)) {
        console.log('[WARN] thisPrice null/0, setting = lastPrice');
        thisPrice = lastPrice;
      }

      // ------------------------------------------------------------
      // 3) Setup totals + orderbook
      // ------------------------------------------------------------
      let systemicLoss = new BigNumber(0);
      let totalPos     = new BigNumber(0);
      let totalNeg     = new BigNumber(0);

      const orderbook = await Orderbook.getOrderbookInstance(contractId);
      const liqQueue  = [];

      // ------------------------------------------------------------
      // 4) FIRST PASS — PNL + solvency
      // ------------------------------------------------------------
      console.log('\n--- FIRST PASS: PNL & SOLVENCY ---');

      for (const pos of positions) {

        if (!pos) {
          console.warn(`[SKIP] null position`);
          continue;
        }

        if (!pos.contracts || pos.contracts === 0) {
          console.log(`[SKIP] addr=${pos.address} contracts=0`);
          continue;
        }

        const tally = await Tally.getTally(pos.address, collateralId);

        const pnl = Clearing.calculateClearingPNL({
          oldContracts: pos.contracts,
          previousMarkPrice: lastPrice,
          currentMarkPrice: thisPrice,
          inverse,
          notional
        });

        console.log(

          `[PNL] ${pos.address} c=${pos.contracts} ` +
          `pnl=${pnl.toFixed()} avail=${tally.available} mar=${tally.margin}`
        );

        if (pnl.isZero()) {
          console.log('  -> ZERO PNL');
          continue;
        }

        if (pnl.gt(0)) {
          console.log('  -> PROFIT (deferred)');
          pos._wasProfitable = true;
          console.log(`[DEFER PROFIT] addr=${pos.address}`);
          continue;
        }

        const loss = pnl.abs();
        const available   = new BigNumber(tally.available || 0);
        const margin      = new BigNumber(tally.margin || 0);
        const maintMargin = margin.div(2);
        const coverage    = available.plus(maintMargin);

        console.log(
          `  LOSS=${loss.toFixed()} ` +
          `coverage=${coverage.toFixed()} ` +
          `(avail=${available.toFixed()} maint=${maintMargin.toFixed()})`
        );

        totalNeg = totalNeg.plus(loss);

        // Fully payable: take loss from available then margin
        if (coverage.gte(loss)) {

          console.log('  -> SOLVENT, clearingLoss');

          const takeAvail  = BigNumber.min(available, loss);
          const takeMargin = loss.minus(takeAvail);

          console.log(
            `[CLEARING LOSS] addr=${pos.address} ` +
            `takeAvail=${takeAvail.toFixed()} takeMargin=${takeMargin.toFixed()}`
          );

          await Tally.updateBalance(
            pos.address,
            collateralId,
            takeAvail.negated().toNumber(),
            0,
            takeMargin.negated().toNumber(),
            0,
            'clearingLoss',
            blockHeight
          );
          continue;
        }

        console.log('  -> INSOLVENT, enqueue liquidation');

        liqQueue.push({
          address: pos.address,
          pos,
          loss,
          shortfall: loss.minus(coverage),
          coverage
        });
      }

      console.log(`[LIQ QUEUE] size=${liqQueue.length}`);

      // ------------------------------------------------------------
      // 5) SECOND PASS — Liquidations
      // ------------------------------------------------------------
      console.log('\n--- SECOND PASS: LIQUIDATIONS ---');
      const liqEvents = [];

      for (const q of liqQueue) {

        console.log(
          `[LIQ] ${q.address} loss=${q.loss.toFixed()} ` +
          `coverage=${q.coverage.toFixed()} shortfall=${q.shortfall.toFixed()}`
        );

        const tally = await Tally.getTally(q.address, collateralId);
        console.log(`[LIQ] pre-tally avail=${tally.available} mar=${tally.margin}`);

        const liquidationType = q.coverage.gt(0) ? 'partial' : 'total';

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
          q.shortfall.toNumber(),
          notional,
          lastPrice,
          true,
          q.shortfall.toNumber(),
          tally,
          priceInfo
        );


        console.log('[LIQ] result=', liq);

        if (!liq) continue;

        systemicLoss = systemicLoss.plus(liq.systemicLoss || 0);

        liqEvents.push({
          address: q.address,
          liquidationType,
          shortfall: q.shortfall.toNumber(),
          coverage: q.coverage.toNumber(),
          loss: q.loss.toNumber(),
          systemicLoss: liq.systemicLoss
        });

        /*if (liq.counterparties?.length > 0) {
          console.log(`[LIQ UPDATE POSITIONS] counterparties=`, liq.counterparties);
          positions = Clearing.updatePositions(positions, liq.counterparties);
        }*/
      }

      // ------------------------------------------------------------
      // 6) THIRD PASS — Profits
      // ------------------------------------------------------------
      console.log('\n--- THIRD PASS: PROFITS ---');

      positions = Clearing.getPositionsFromCache(ctxKey);
      console.log(`[PROFIT PASS] positions.length=${positions.length}`);

      for (const pos of positions) {
        if (!pos?.contracts || pos.contracts === 0) {
          delete pos._wasProfitable;
          continue;
        }

        const profit = Clearing.calculateClearingPNL({
          oldContracts: pos.contracts,
          previousMarkPrice: lastPrice,
          currentMarkPrice: thisPrice,
          inverse,
          notional
        });

        if (profit.gt(0)) {
          console.log(`[PROFIT] ${pos.address} +${profit.toFixed()}`);
          totalPos = totalPos.plus(profit);

          await Tally.updateBalance(
            pos.address,
            collateralId,
            profit.toNumber(),
            0,
            0,
            0,
            'clearingProfit',
            blockHeight
          );
        }

        delete pos._wasProfitable;
      }

      // ------------------------------------------------------------
      // 7) Normalize marks *AFTER* clearing
      // ------------------------------------------------------------
      console.log('\n--- NORMALIZE MARKS (POST CLEARING) ---');
      await Clearing.normalizePositionMarks(
        positions,
        thisPrice,
        null,
        contractId,
        blockHeight
      );

      // ------------------------------------------------------------
      // 8) Final accounting
      // ------------------------------------------------------------
      totalNeg = totalNeg.minus(systemicLoss);
      const pnlDelta = totalPos.minus(totalNeg);


      console.log(`[SUMMARY] totalPos=${totalPos.toFixed()} totalNeg=${totalNeg.toFixed()} systemicLoss=${systemicLoss.toFixed()}`);
      console.log(`[SUMMARY] pnlDelta=${pnlDelta.toFixed()}`);

      const finalPositions = Clearing.flushPositionCache(ctxKey);
      console.log(`[WRITE] finalPositions.length=${finalPositions.length}`);
      await marginMap.mergePositions(finalPositions, contractId, true);

      console.log(`================ END UPDATE MARGIN MAPS ================\n`);

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
      static computeLiquidationPriceFromLoss(
        lastPrice,
        equity,
        contracts,
        notional,
        inverse
      ) {
        const PRECISION = 30;
        console.log('last price in compute liq price '+lastPrice+' '+equity+' '+contracts)
        const BNLast = new BigNumber(lastPrice);
        const BNEq = new BigNumber(equity);
        const BNContracts = new BigNumber(contracts);
        const BNNotional = new BigNumber(notional);

        if (BNContracts.isZero() || BNEq.lte(0)) {
          return BNLast.decimalPlaces(PRECISION);
        }

        // -------------------------------
        // LINEAR CONTRACTS
        // PnL = contracts × notional × (price − lastPrice)
        // -------------------------------
        if (!inverse) {
          if (BNContracts.gt(0)) {
            // Long → bankruptcy below lastPrice
            return BNLast
              .minus(BNEq.div(BNContracts.multipliedBy(BNNotional)))
              .decimalPlaces(PRECISION);
          } else {
            // Short → bankruptcy above lastPrice
            return BNLast
              .plus(BNEq.div(BNContracts.absoluteValue().multipliedBy(BNNotional)))
              .decimalPlaces(PRECISION);
          }
        }

        // -------------------------------
        // INVERSE CONTRACTS
        // PnL = contracts × notional × (1/lastPrice − 1/price)
        // -------------------------------
        const invLast = new BigNumber(1).dividedBy(BNLast);

        if (BNContracts.gt(0)) {
          // Inverse long → bankruptcy at lower price
          const invBkr = invLast.plus(
            BNEq.div(BNContracts.multipliedBy(BNNotional))
          );
          return new BigNumber(1).dividedBy(invBkr).decimalPlaces(PRECISION);
        } else {
          // Inverse short → bankruptcy at higher price
          const invBkr = invLast.minus(
            BNEq.div(BNContracts.absoluteValue().multipliedBy(BNNotional))
          );
          return new BigNumber(1).dividedBy(invBkr).decimalPlaces(PRECISION);
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
        if (!updatedCounterparties) return positions;
        
        const counterpartyMap = new Map(updatedCounterparties.map(pos => [pos.address, pos]));
        const result = positions.map(pos => 
            counterpartyMap.has(pos.address) 
                ? { ...pos, ...counterpartyMap.get(pos.address) }
                : pos
        );
        
        // Add any counterparties that weren't in original positions
        for (const cp of updatedCounterparties) {
            if (!positions.find(p => p.address === cp.address)) {
                result.push({ ...cp });
            }
        }
        
        return result;
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
        marginDent,          // positive number = RESIDUAL loss to resolve (post updateMarginMaps debit)
        notional,
        markPrice,
        applyDent,
        markShortfall,
        tallySnapshot,
        priceInfo
      ) {
        const Clearing = this;
        const MarginMap = require('./marginMap.js');
        const marginMap = await MarginMap.getInstance(contractId);

        const BigNumber = require('bignumber.js');
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
          // If we were called, insolvency/shortfall already exists upstream.
          // Force a liquidation amount rather than returning null.
          liqAmount = Math.abs(position.contracts);
          liquidationType = "total";
          console.warn(`⚠️ liqAmount computed <=0; forcing total liquidation for ${liquidatingAddress}`);
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

        console.log('estimate bankruptcyPrice' +computedLiqPrice)

        //------------------------------------------------------------
        // 3. Generate liquidation order object
        //------------------------------------------------------------
        let liq = await marginMap.generateLiquidationOrder(
          position,
          contractId,
          liquidationType === "total",
          blockHeight,
          markPrice,
          computedLiqPrice
        );

        if (!liq || liq === "err:0 contracts") return null;

        liq.amount = liqAmount;
        liq.price = liq.price || computedLiqPrice;
        liq.bankruptcyPrice = liq.bankruptcyPrice || computedLiqPrice;

        const bankruptcyPrice = liq.bankruptcyPrice;
        // force liquidation side from position sign (do this before estimateLiquidation)
        const isSell = (position.contracts > 0); // long -> SELL into bids, short -> BUY into asks
        liq.sell = isSell;


        //------------------------------------------------------------
        // 4. Estimate book fill BEFORE inserting order
        //------------------------------------------------------------
        console.log('contractId before est Liq '+contractId)
        const splat = await orderbook.estimateLiquidation(liq, notional, computedLiqPrice,computedLiqPrice,inverse,contractId);
        console.log("🔎 estimateLiquidation →", JSON.stringify(splat));
        const canObFill = (splat && Number(splat.goodFilledSize || 0) > 0);
        console.log('can Ob Fill '+canObFill+' '+splat.goodFilledSize)
        // ============================================================
        // FIX B1: residual-loss semantics
        // updateMarginMaps already debited "coverage". marginDent here
        // is the RESIDUAL that must be resolved by confiscation/pool/ADL.
        // So totalLossNeeded = shortfall only.
        // ============================================================
        const shortfallBN = new Big(marginDent || 0);
        let lossBN = shortfallBN; // <-- key change (was coverage+shortfall)

        //------------------------------------------------------------
        // 6. Attempt OB matching
        //------------------------------------------------------------
        let obFill = new Big(0);

        let markImprovement = 0;
        const preTradePositions = positionCache.map(p => ({ ...p }));
        if (canObFill) {
          console.log('inside liquidation order drop!')
          const obKey = contractId.toString();
          let obData = orderbook.orderBooks[obKey] || { buy: [], sell: [] };

          // ============================================================
          // FIX B2: only insert the SAFE prefix size (goodFilledSize),
          // so the matching engine can’t fill beyond the safe-at-or-better
          // amount in the same call.
          // ============================================================
          const safeSize = Number(splat.goodFilledSize || 0);
          const liqOb = { ...liq, amount: safeSize };

          console.log('safe size!? '+safeSize)

          obData = await orderbook.insertOrder(liqOb, obData, liqOb.sell, true);
          let trades= []

          const matchResult = await orderbook.matchContractOrders(obData);   
          if (matchResult.matches && matchResult.matches.length > 0) {
                trades= await orderbook.processContractMatches(matchResult.matches, blockHeight, false,markPrice);
          }

          console.log('liq match result '+JSON.stringify(matchResult))
          await orderbook.saveOrderBook(matchResult.orderBook, obKey);

           // PATCH 1: set obFill to what actually matched (best-effort from match objects)
          let filledFromMatches = 0;
          if (matchResult && Array.isArray(matchResult.matches)) {
            for (const m of matchResult.matches) {
              console.log('match '+JSON.stringify(m))
              const qty =
              Number(m.sellOrder?.amount ?? m.buyOrder?.amount ?? 0);
              
              if (qty > 0) filledFromMatches += qty;
            }
          }

          // Never exceed requested liqAmount
          obFill = new Big(Math.min(filledFromMatches, liqAmount));
          console.log('obFill after matches '+obFill.toNumber()+' '+filledFromMatches+' '+liqAmount)

                
      // ============================================================
      // ✅ CANONICAL FIX: advance positionCache from TRADE RESULTS
      // ============================================================
      // ============================================================
      // Apply ONLY the final position per address from this batch
      // ============================================================
      if (trades.length>0){
        const finalPositions = new Map(); // addr -> position

          for (const t of trades) {
            if (t.buyerAddress && t.buyerPosition) {
              finalPositions.set(t.buyerAddress, t.buyerPosition);
            }
            if (t.sellerAddress && t.sellerPosition) {
              finalPositions.set(t.sellerAddress, t.sellerPosition);
            }
          }

          for (const [addr, pos] of finalPositions.entries()) {
            Clearing.addOrUpdatePositionInCache(ctxKey, addr, pos);
            console.log(`[CACHE APPLY FINAL] ${addr} contracts=${pos.contracts}`
            );
          }
        }

      }

        await Clearing.settleLiqNewContractsFromDB(contractId, blockHeight, priceInfo.thisPrice,ctxKey,preTradePositions)

        //------------------------------------------------------------
        // 7. Determine ADL remainder
        //------------------------------------------------------------
        const adlSize = new Big(liqAmount).minus(obFill);
        const remainder = adlSize.gt(0) ? adlSize.toNumber() : 0;

        let residualLossBN = new Big(0);
        if (remainder > 0) {
          //------------------------------------------------------------
          // 7.5 Recompute residual loss for the UNFILLED size
          // Loss = remainder contracts moving from lastMark to thisPrice
          //------------------------------------------------------------
          const qtyBN = new Big(remainder).dp(8);
          const lastBN = new Big(priceInfo.lastPrice || markPrice);
          const thisBN = new Big(priceInfo.thisPrice || markPrice);
          const notBN = new Big(notional || 1);

          if (!inverse) {
            // Linear: loss = qty * |lastMark - thisPrice| * notional
            residualLossBN = qtyBN.times(lastBN.minus(thisBN).abs()).times(notBN);
          } else {
            // Inverse: loss = qty * |1/thisPrice - 1/lastMark| * notional
            if (lastBN.gt(0) && thisBN.gt(0)) {
              const invLast = new Big(1).div(lastBN);
              const invThis = new Big(1).div(thisBN);
              residualLossBN = qtyBN.times(invThis.minus(invLast).abs()).times(notBN);
            }
          }
          residualLossBN = residualLossBN.dp(8);
        }

        console.log('residual loss for remainder ' + residualLossBN.toNumber() + ' ' + remainder + ' last=' + priceInfo.lastPrice + ' this=' + priceInfo.thisPrice);

        //------------------------------------------------------------
        // 8. Calculate liquidation pool BEFORE confiscation
        // Pool = min(what we need, what's available)
        //------------------------------------------------------------
        const liqTally = await Tally.getTally(liquidatingAddress, collateralId);
        const fullPoolBN = new Big(liqTally.margin || 0)
          .plus(liqTally.available || 0)
          .dp(8);

        const seizureBN = Big.min(fullPoolBN, residualLossBN).dp(8);
        const liquidationPool = seizureBN.toNumber();
        console.log('liquidation pool ' + liquidationPool + ' (needed=' + residualLossBN.toNumber() + ' available=' + fullPoolBN.toNumber() + ')');

        //------------------------------------------------------------
        // 9. Confiscate liquidation pool (seized amount only)
        // Debit available first, then margin
        //------------------------------------------------------------
        if (liquidationPool > 0) {
          const availBN = new Big(liqTally.available || 0);
          const seizeAvailBN = Big.min(availBN, seizureBN).dp(8);
          const seizeMarginBN = seizureBN.minus(seizeAvailBN).dp(8);

          await Tally.updateBalance(
            liquidatingAddress,
            collateralId,
            -seizeAvailBN.toNumber(),
            0,
            -seizeMarginBN.toNumber(),
            0,
            'liquidationPoolDebit',
            blockHeight
          );
        }

        //------------------------------------------------------------
        // 10. Systemic loss - use actual shortfall vs seized amount
        //------------------------------------------------------------
        let systemicLoss = new Big(0);

        const totalLossNeeded = lossBN;
        const seizedBN = new Big(liquidationPool);

        if (totalLossNeeded.gt(seizedBN)) {
          systemicLoss = totalLossNeeded.minus(seizedBN).dp(8);
        }

        //------------------------------------------------------------
        // 11. Apply ADL if needed - pass actual pool amount
        //------------------------------------------------------------
        let result = { counterparties: [], poolAssignments: [] };
        if (remainder > 0) {
          result = await marginMap.simpleDeleverage(
            positionCache,
            contractId,
            remainder,
            isSell,
            bankruptcyPrice,
            liquidatingAddress,
            inverse,
            notional,
            blockHeight,
            markPrice,
            collateralId,
            liquidationPool
          );
        }
        console.log('adl result '+JSON.stringify(result));

        //------------------------------------------------------------
        // 12. Apply pool credits from ADL - CAPPED at pool
        //------------------------------------------------------------
        let poolRemaining = new Big(liquidationPool);

        for (const u of (result.poolAssignments || [])) {
          if (poolRemaining.lte(0)) break;

          const share = new Big(u.poolShare || 0);
          if (share.lte(0)) continue;

          const creditAmount = Big.min(share, poolRemaining).dp(8);

          await Tally.updateBalance(
            u.address,
            collateralId,
            creditAmount.toNumber(),
            0, 0, 0,
            'deleveragePoolCredit',
            blockHeight
          );

          poolRemaining = poolRemaining.minus(creditAmount);
        }

        //------------------------------------------------------------
        // 13. Apply CP position updates
        //------------------------------------------------------------
        for (const cp of (result.counterparties || [])) {
          Clearing.updatePositionInCache(ctxKey, cp.address, () => ({ ...cp.updatedPosition }));
          Clearing.recordDeleverageTrade(contractId, cp.address, cp);
        }

        //------------------------------------------------------------
        // 14. Zero out liquidated position
        //------------------------------------------------------------
        console.log('zero out liqd addr '+liquidatingAddress+' '+ctxKey)
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
          counterparties: result.counterparties || [],
          totalDeleveraged: obFill.plus(remainder).dp(8).toNumber()
        };
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
    }){
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
        console.log('new contract clearing PNL '+pnl.toNumber()+' '+size.toNumber()+' '+avg.toNumber()+' '+exec.toNumber())
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

     static async settleIousForBlock(contractId, collateralId, blockHeight) {
        const doc = await PnlIou.getDoc(contractId, collateralId);
        if (!doc) return;
        
        const TallyMap = require('./tally.js');
        const BigNumber = require('bignumber.js');
        
        console.log('doc in settleIous: ' + JSON.stringify(doc));
        
        // CRITICAL FIX: Use blockLosses directly instead of blockReductionTowardZero
        // blockLosses = real tokens debited from losers this block, available for payout
        const blockLosses = new BigNumber(doc.blockLosses || 0);
        
        console.log('blockLosses for payout: ' + blockLosses.toNumber());
        
        if (blockLosses.lte(0)) {
            console.log('[settleIous] No losses this block to pay out');
            return;
        }
        
        const allocations = await PnlIou.payOutstandingIous(
            contractId,
            collateralId,
            blockLosses.toNumber(),
            blockHeight
        );
        
        console.log('allocations: ' + JSON.stringify(allocations));
        
        if (!allocations.length) return;
        
        for (const a of allocations) {
            await TallyMap.updateBalance(
                a.address,
                collateralId,
                a.amount,
                0, 0, 0,
                'iouPayout',
                blockHeight,
                ''
            );
        }
    }


    static async performAdditionalSettlementTasks(blockHeight,positions, contractId, mark,totalLossSN,collateralId,pnlDelta){        
         
          const totalLoss= new BigNumber(totalLossSN)
       //try {
                // Step 2: Check if insurance fund payout is needed
          console.log(
            'total loss for '+contractId+' '+
            (typeof totalLoss === 'object' && totalLoss.toNumber ? totalLoss.toNumber() : totalLoss)
          );
        
          if (totalLoss.gte(0)) {
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