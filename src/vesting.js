const InsuranceFund = require('./insurance.js');
const PropertyManager = require('./property.js'); // Assuming Property has the createToken method
const ClearList = require('./clearlist.js')
const ContractList = require('./contractRegistry.js')
const BigNumber = require('bignumber.js')
const ClientWrapper = require('./client.js')

class TradeLayerManager {
    static instance = null;

    constructor(adminAddress,chain) {
        if (!TradeLayerManager.instance) {
            this.adminAddress = adminAddress;
            this.setChainParams(chain);
            TradeLayerManager.instance = this;
        }
    }

    setChainParams(chain) {
        // Access the chain via the client or environment variable
       
        
        // Configure parameters based on the chain
        if (this.chain === 'BTC') {
            this.baseVolume = 100;
            this.minRebate = 0.00000625;
            this.maxRebate = 0.0001;
            this.initialTokenAmount = 600000;
            this.tickerSymbol = 'TB';
            this.hedgeLeverage = 5;
            this.expiryInterval = 12960
        } else if (this.chain === 'DOGE') {
            this.baseVolume = 2000000;
            this.minRebate = 0.00000125;
            this.maxRebate = 0.0005;
            this.initialTokenAmount = 200000000;
            this.tickerSymbol = 'TD';
            this.hedgeLeverage = 10;
            this.expiryInterval = 129600
        } else { // Default to Litecoin (LTC)
            this.baseVolume = 1000;
            this.minRebate = 0.000003125;
            this.maxRebate = 0.0001;
            this.initialTokenAmount = 1500000;
            this.tickerSymbol = 'TL';
            this.hedgeLeverage = 5;
            this.expiryInterval= 51840
        }
    }

    static async getInstance(adminAddress, chain){
        if (!TradeLayerManager.instance) {
            TradeLayerManager.instance = new TradeLayerManager(adminAddress.chain);
            console.log('generating new TL manager')
        }
        console.log('returning TL Manager')
        return TradeLayerManager.instance;
    }

    async initializeTokens(block) {
        const TallyMap = require('./tally.js');
         const alreadyInitialized = await TallyMap.checkInitializationFlag();
        
        if(this.adminAddress==undefined||this.adminAddress==null){
            this.adminAddress="tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"
        }
         
        if (!alreadyInitialized) {
            var TLTokenId = 1;
            const TLTotalAmount = this.initialTokenAmount;
            const ticker = this.tickerSymbol;
            const vestTicker = ticker+"VEST"
            const incomeTicker = ticker+"I"
            const incomeVestTicker = incomeTicker + "VEST"
            var TLVESTTokenId = 2;
            const TLVESTTotalAmount = new BigNumber(TLTotalAmount).dividedBy(2).toNumber();
            var amountToInsuranceFund = new BigNumber(TLVESTTotalAmount).times(0.6).toNumber();
            const TLInitialLiquidity = new BigNumber(TLVESTTotalAmount).times(0.4).toNumber();
            const TLVESTReserve = TLTotalAmount-amountToInsuranceFund-TLInitialLiquidity
            const TLIVESTinitialLiquidity = TLTotalAmount
            const TLITotalAmount = TLIVESTinitialLiquidity+1
            const propertyManager = PropertyManager.getInstance()
            TLTokenId = await propertyManager.createToken(ticker, TLTotalAmount, 'Fixed', 0);
            TLVESTTokenId = await propertyManager.createToken(vestTicker, TLVESTTotalAmount, 'Vesting',0);
            const TLIVESTToken = await propertyManager.createToken(incomeTicker, TLIVESTinitialLiquidity, 'Vesting', 0)
            const TLI = await propertyManager.createToken(incomeVestTicker, TLITotalAmount, 'Native',0)

            const hedgeParams = {
                native: true,
                underlyingOracleId: 0,
                onChainData: [[0,1]],
                notionalPropertyId: 0,
                notionalValue: 0.0001,
                collateralPropertyId: 1,
                leverage: 5,
                expiryPeriod: 4032,
                series: 5,
                inverse: true,
                fee: false
            }

            const NativeHedgeId = await TradeLayerManager.initializeContractSeries(block)

            console.log('verifying that propertyid numbering is consistent with native contract id '+TLTokenId,TLVESTTokenId,NativeHedgeId)
            var insuranceFund = new InsuranceFund(1,0,0.5,false)
            // Distribute initial amount to insurance fund
            insuranceFund.deposit(TLTokenId,amountToInsuranceFund,false)
            
            await TallyMap.updateBalance(this.adminAddress, TLTokenId, TLInitialLiquidity, 0, 0, 0);
            await TallyMap.updateBalance(this.adminAddress, TLVESTTokenId, TLVESTTotalAmount, 0, 0, TLVESTTotalAmount);
            await TallyMap.updateBalance(this.adminAddress, TLIVESTToken, 1500000, 0,0, 1500000)
            await TallyMap.updateBalance(this.adminAddress, TLI, 1,0,0,0)

            const balances = await TallyMap.getAddressBalances(this.adminAddress)

            //await initializeContractSeries()
            await TradeLayerManager.initializeClearlists();

            // After initializing tokens, set the flag
            await TallyMap.setInitializationFlag();
            return balances
        }
    }

    static async initializeContractSeries(block) {
        const params = {
            // Define contract properties such as margin requirements, expiry, etc.
            // Example properties:
            initialMargin: 0.1, // 10%
            maintenanceMargin: 0.05, // 5%
            expiry: 'perp', //need to assure that perp or 0 or null etc. codes to perpetual
            onChainData: [[1, 0]], //LTC vs. TL, need to assure that the propertyid for TL init's to 1 and that 0 corresponds to LTC UTXO
            expiryInterval: this.expiryInterval,
            leverage: this.hedgeLeverage||5,
            seriesLength: 6,
            native:true,
            inverse: true,
            fee: false,
            notionalPropertyId: 0,
            notionalValue: 0.0001,
            collateralPropertyId: 1
        };

        // Create the contract series
        return await ContractList.createContractSeries(this.adminAddress, params, block);


        // Additional setup if required, such as initializing order books, setting initial market conditions, etc.
    }

     static async initializeClearlists() {

        // Initialize issuer whitelist
        const issuerClearlistId = ClearList.createClearlist(
            this.adminAddress,
            'Issuer Whitelist',
            '',
            'Oracles and Tokens included in Liquidity Reward',
            ''
        );

        // Initialize market maker whitelist
        const marketMakerClearlistId = ClearList.createClearlist(
            this.adminAddress,
            'Market Maker Whitelist',
            '',
            'Market Makers and active traders who do not wash trade.'
        );

        console.log(`Issuer whitelist created with ID: ${issuerClearlistId}`);
        console.log(`Market maker whitelist created with ID: ${marketMakerClearlistId}`);
    }

    static async updateVesting(cumulativeVolumeLTC, currentBlockVolumeLTC, cumulativeVolumeGlobal, currentBlockVolumeGlobal) {
        const propertyData1 = await PropertyManager.getPropertyData(2)
        const propertyData2 = await PropertyManager.getPropertyData(3)
        if(propertyData1==null){
            return null    
        }
        let maxTokens2 = propertyData1.totalInCirculation
        let maxTokens3 = propertyData2.totalInCirculation
        // Constants for the first tranche (LTC volume)
        const logScaleMin1 = new BigNumber(1000);
        const logScaleMax1 = new BigNumber(100000000);

        // Constants for the second tranche (Global volume)
        const logScaleMin2 = new BigNumber(10000000);
        const logScaleMax2 = new BigNumber(1000000000000);
        console.log('inside update vesting '+cumulativeVolumeLTC+' '+currentBlockVolumeLTC+' '+cumulativeVolumeGlobal+' '+currentBlockVolumeGlobal+' '+maxTokens2+' '+maxTokens3)

        // Convert inputs to BigNumber
        cumulativeVolumeLTC = new BigNumber(cumulativeVolumeLTC);
        currentBlockVolumeLTC = new BigNumber(currentBlockVolumeLTC);
        cumulativeVolumeGlobal = new BigNumber(cumulativeVolumeGlobal);
        currentBlockVolumeGlobal = new BigNumber(currentBlockVolumeGlobal);
        maxTokens2 = new BigNumber(maxTokens2);
        maxTokens3 = new BigNumber(maxTokens3)

        // Calculate cumulative volume after this block
        const newCumulativeVolumeLTC = cumulativeVolumeLTC.plus(currentBlockVolumeLTC);
        const newCumulativeVolumeGlobal = cumulativeVolumeGlobal.plus(currentBlockVolumeGlobal);

               // First Tranche Vesting (Based on LTC volume)
        let vestingFactorPrev1 = new BigNumber(Math.log(cumulativeVolumeLTC.toNumber())).div(Math.log(logScaleMax1.toNumber()));
        vestingFactorPrev1 = BigNumber.min(BigNumber.max(vestingFactorPrev1, new BigNumber(0)), new BigNumber(1));

        let vestingFactorNew1 = new BigNumber(Math.log(newCumulativeVolumeLTC.toNumber())).div(Math.log(logScaleMax1.toNumber()));
        vestingFactorNew1 = BigNumber.min(BigNumber.max(vestingFactorNew1, new BigNumber(0)), new BigNumber(1));

        const vestingFactorDifference1 = vestingFactorNew1.minus(vestingFactorPrev1);

        // Second Tranche Vesting (Based on Global volume)
        let vestingFactorPrev2 = new BigNumber(Math.log(cumulativeVolumeGlobal.toNumber())).div(Math.log(logScaleMax2.toNumber()));
        vestingFactorPrev2 = BigNumber.min(BigNumber.max(vestingFactorPrev2, new BigNumber(0)), new BigNumber(1));

        let vestingFactorNew2 = new BigNumber(Math.log(newCumulativeVolumeGlobal.toNumber())).div(Math.log(logScaleMax2.toNumber()));
        vestingFactorNew2 = BigNumber.min(BigNumber.max(vestingFactorNew2, new BigNumber(0)), new BigNumber(1));

        const vestingFactorDifference2 = vestingFactorNew2.minus(vestingFactorPrev2);

          // Calculate the vesting amount based on the total difference and max vesting tokens
        let vestingAmount = vestingFactorDifference1.multipliedBy(maxTokens2);

        // Round vesting amount to 8 decimal places
        vestingAmount = vestingAmount.decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber()

        // Calculate the vesting amount based on the total difference and max vesting tokens
        let vestingAmount2 = vestingFactorDifference2.multipliedBy(maxTokens3);

        // Round vesting amount to 8 decimal places
        vestingAmount2 = vestingAmount2.decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber()
        console.log('ending vest calc '+vestingAmount+' '+vestingAmount2)
        return {two:vestingAmount,three:vestingAmount2};
    }

     static calculateTradeRebates(cumulativeVolume) {
        const { baseVolume, minRebate, maxRebate } = TradeLayerManager.instance;
        if (cumulativeVolume < baseVolume) {
            return maxRebate;
        }
        const scale = Math.log(cumulativeVolume / baseVolume) / Math.log(100000000 / baseVolume);
        const rebate = maxRebate - scale * (maxRebate - minRebate);
        return Math.max(rebate, minRebate);
    }

    static performBuyback(feeCaches) {
        feeCaches.forEach(cache => {
            const orderbook = this.fetchOrderbookForToken(cache.tokenId);
            const buybackAmount = this.calculateBuybackAmount(cache, orderbook);
            // Execute buyback transaction
        });
    }

    static fetchOrderbookForToken(tokenId) {
        // Fetch the orderbook for the given token
        // Implementation depends on your system's data sources
    }

    static calculateBuybackAmount(cache, orderbook) {
        let availableFunds = cache.funds;
        let totalBuybackAmount = 0;

        for (const order of orderbook) {
            const orderCost = order.price * order.amount;
            if (availableFunds >= orderCost) {
                totalBuybackAmount += order.amount;
                availableFunds -= orderCost;
            } else {
                const partialAmount = availableFunds / order.price;
                totalBuybackAmount += partialAmount;
                availableFunds = 0;
                break;
            }

            if (availableFunds <= 0) break;
        }

        return totalBuybackAmount;
    }
}

module.exports = TradeLayerManager;
