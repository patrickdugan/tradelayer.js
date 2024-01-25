const BigNumber = require('bignumber.js')
const dbInstance = require('./db.js'); // Import your database instance
const { v4: uuidv4 } = require('uuid');  // Import the v4 function from the uuid library
const TradeHistory = require('./tradeHistoryManager.js')
const ContractRegistry = require('./contractRegistry.js')

class Orderbook {
      constructor(orderBookKey, tickSize = new BigNumber('0.00000001')) {
            this.tickSize = tickSize;
            this.orderBookKey = orderBookKey; // Unique identifier for each orderbook (contractId or propertyId pair)
            this.orderBooks = {};
            this.loadOrCreateOrderBook(); // Load or create an order book based on the orderBookKey
        }
         // Static async method to get an instance of Orderbook
        static async getOrderbookInstance(orderBookKey) {
            const orderbook = new Orderbook(orderBookKey);
            await orderbook.loadOrCreateOrderBook(); // Load or create the order book
            return orderbook;
        }

         async loadOrCreateOrderBook(key, flag) {
            console.log('key before the string treatment '+key)
            const stringKey = typeof key === 'string' ? key : String(key);
            const orderBooksDB = dbInstance.getDatabase('orderBooks');
             console.log('checking orderbook in this cancel call '+stringKey)
            try{
                 const orderBookData = await orderBooksDB.findOneAsync({ _id: stringKey });
               if (orderBookData && orderBookData.value) {
                    this.orderBooks[key] = JSON.parse(orderBookData.value);
                    //console.log('loading the orderbook for ' + key + ' in the form of ' + JSON.stringify(orderBookData))
                }else{

                }
            }   catch (error) {
                 console.error('Error loading or parsing order book data:', error);
                // Handle the error as needed, e.g., by logging, notifying, or taking corrective actions.
            }
           /* else {
                // If no data found, create a new order book
                this.orderBooks[key] = { buy: [], sell: [] };
                console.log('loading fresh orderbook ' + this.orderBooks[key])

                await this.saveOrderBook(key);
            }*/
        }

        async saveOrderBook(key) {
            // Save order book to your database
            console.log('saving book ' + JSON.stringify(key) + ' ' + JSON.stringify(this.orderBooks[key]))
            
            const orderBooksDB = dbInstance.getDatabase('orderBooks');
            await orderBooksDB.updateAsync(
                { _id: key },
                { _id: key, value: JSON.stringify(this.orderBooks[key]) },
                { upsert: true }
            );
        }

                // Record a token trade with specific key identifiers
        async recordTokenTrade(trade, blockHeight, txid) {
            const tradeRecordKey = `token-${trade.offeredPropertyId}-${trade.desiredPropertyId}`;
            const tradeRecord = {
                key: tradeRecordKey,
                type: 'token',
                trade,
                blockHeight,
                txid
            };
            await this.saveTrade(tradeRecord);
        }

        // Record a contract trade with specific key identifiers
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
            console.log('saving contract trade ' +JSON.stringify(trade))
            await this.saveTrade(tradeRecord);
        }

        async saveTrade(tradeRecord) {
            const tradeDB = dbInstance.getDatabase('tradeHistory');

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
                console.error(`Error saving trade record: ${tradeId}`, error);
                throw error; // Rethrow the error for handling upstream
            }
    }

        // Retrieve token trading history by propertyId pair
        static async getTokenTradeHistoryByPropertyIdPair(propertyId1, propertyId2) {
                const tradeDB = dbInstance.getDatabase('tradeHistory');
                const tradeRecordKey = `token-${propertyId1}-${propertyId2}`;
                const trades = await tradeDB.findAsync({ key: tradeRecordKey });
                return trades.map(doc => doc.trade);
        }

        // Retrieve contract trading history by contractId
        static async getContractTradeHistoryByContractId(contractId) {
                console.log('loading trade history for '+contractId)
                const tradeDB = dbInstance.getDatabase('tradeHistory');
                const tradeRecordKey = `contract-${contractId}`;
                const trades = await tradeDB.findAsync({ key: tradeRecordKey });
                return trades.map(doc => doc.trade);
        }

        // Retrieve trade history by address for both token and contract trades
        static async getTradeHistoryByAddress(address) {
                const tradeDB = dbInstance.getDatabase('tradeHistory');
                const trades = await tradeDB.findAsync({ 
                    $or: [{ 'trade.sender': address }, { 'trade.receiverAddress': address }]
                });
                return trades.map(doc => doc.trade);
        }

        // Function to divide two numbers with an option to round up or down to the nearest Satoshi
        divideAndRound(number1, number2, roundUp = false) {
            const result = new BigNumber(number1).dividedBy(new BigNumber(number2));
            return roundUp
                ? result.decimalPlaces(8, BigNumber.ROUND_UP).toString()
                : result.decimalPlaces(8, BigNumber.ROUND_DOWN).toString();
        }

        // Adds a token order to the order book
        async addTokenOrder(order, blockHeight, txid) {
            const TallyMap = require('./tally.js'); //lazy load so we can move available to reserved for this order
            await TallyMap.updateBalance(order.sender, order.offeredPropertyId, -order.amountOffered, order.amountOffered, 0, 0,'tokenOrder');
            
            // Determine the correct orderbook key
            const normalizedOrderBookKey = this.normalizeOrderBookKey(order.offeredPropertyId, order.desiredPropertyId);
            //console.log('Normalized Order Book Key:', normalizedOrderBookKey);

            // Create an instance of Orderbook for the pair and load its data
            const orderbook = new Orderbook(normalizedOrderBookKey);
            await orderbook.loadOrCreateOrderBook(this.orderBookKey);

            // Calculate the price for the order and round to the nearest tick interval
            const calculatedPrice = this.calculatePrice(order.amountOffered, order.amountExpected);
            //console.log('Calculated Price:', calculatedPrice);
            order.price = calculatedPrice; // Append the calculated price to the order object

            // Determine if the order is a sell order
            const isSellOrder = order.offeredPropertyId < order.desiredPropertyId;

            // Add the order to the orderbook
            const orderConfirmation = await orderbook.insertOrder(order, normalizedOrderBookKey, isSellOrder);
            //console.log('Order Insertion Confirmation:', orderConfirmation);

            // Match orders in the orderbook
            const matchResult = await orderbook.matchTokenOrders(normalizedOrderBookKey);
            if (matchResult.matches && matchResult.matches.length > 0) {
                //console.log('Match Result:', matchResult);
                await this.processTokenMatches(matchResult.matches, blockHeight, txid);
            }else{console.log('No Matches for ' +txid)}
            //console.log('Normalized Order Book Key before saving:', normalizedOrderBookKey);

            // Save the updated orderbook back to the database
            await orderbook.saveOrderBook(normalizedOrderBookKey);

            return matchResult;
        }

        normalizeOrderBookKey(propertyId1, propertyId2) {
            // Ensure lower property ID is first in the key
            return propertyId1 < propertyId2 ? `${propertyId1}-${propertyId2}` : `${propertyId2}-${propertyId1}`;
        }

        async insertOrder(order, orderBookKey, isBuyOrder) {
            if (!this.orderBooks[orderBookKey]) {
                this.orderBooks[orderBookKey] = { buy: [], sell: [] };
            }

            const side = isBuyOrder ? 'buy' : 'sell';
            const bookSide = this.orderBooks[orderBookKey][side];

            const index = bookSide.findIndex((o) => o.time > order.time);
            if (index === -1) {
                bookSide.push(order);
            } else {
                bookSide.splice(index, 0, order);
            }
            return `Order added to ${side} side of book ${orderBookKey}`;
        }

        calculatePrice(amountOffered, amountExpected) {
            const priceRatio = new BigNumber(amountOffered).dividedBy(amountExpected);
            //console.log('price ratio '+priceRatio)
            return priceRatio.decimalPlaces(8, BigNumber.ROUND_HALF_UP).toNumber();
        }

        async matchTokenOrders(orderBookKey) {

                const orderBook = this.orderBooks[orderBookKey];
                if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
                    return { orderBook: this.orderBooks[orderBookKey], matches: [] }; // Return empty matches
                }

                let matches = [];
                let matchOccurred = false;

                // Sort buy and sell orders
                orderBook.buy.sort((a, b) => BigNumber(b.price).comparedTo(a.price) || a.time - b.time); // Highest price first
                orderBook.sell.sort((a, b) => BigNumber(a.price).comparedTo(b.price) || a.time - b.time); // Lowest price first

                // Match orders
                while (orderBook.sell.length > 0 && orderBook.buy.length > 0) {
                    let sellOrder = orderBook.sell[0];
                    let buyOrder = orderBook.buy[0];

                    let tradePrice 
                    if(sellOrder.blockTime == buyOrder.blockTime){
                        console.log('trades in the same block, defaulting to buy order')
                        tradePrice = buyOrder.price
                    }else{
                        tradePrice = sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
                    }


                    // Check for price match
                    if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {


                        // Ensure that sellOrder.amountOffered and buyOrder.amountExpected are BigNumber objects
                        let sellOrderAmountOffered = new BigNumber(sellOrder.amountOffered);
                        let buyOrderAmountExpected = new BigNumber(buyOrder.amountExpected);

                        // Use BigNumber methods to perform calculations
                        let amountOfTokenA = BigNumber.min(sellOrderAmountOffered, buyOrderAmountExpected.times(tradePrice));
                        let amountOfTokenB = BigNumber(amountOfTokenA).div(tradePrice);

                        // Update orders after the match
                        sellOrder.amountOffered = BigNumber(sellOrder.amountOffered).minus(amountOfTokenA).toNumber();
                        buyOrder.amountExpected = BigNumber(buyOrder.amountExpected).minus(amountOfTokenB).toNumber();

                        // Add to matches
                        matches.push({ sellOrder, 
                                        buyOrder, 
                                        amountOfTokenA: amountOfTokenA.toNumber(), 
                                        amountOfTokenB: amountOfTokenB.toNumber(),
                                        tradePrice });
                        matchOccurred = true;


                        // Remove filled orders from the order book
                        if (sellOrder.amountOffered==0){orderBook.sell.shift();}
                        if (buyOrder.amountExpected==0){orderBook.buy.shift();}
                    } else {
                        break; // No more matches possible
                    }
                }

                    return { orderBook: this.orderBooks[orderBookKey], matches };
        }

        async processTokenMatches(matches, blockHeight, txid) {
            const TallyMap = require('./tally.js');
            if (!Array.isArray(matches) || matches.length === 0) {
                //console.log('No valid matches to process');
                return;
            }

            for (const match of matches) {
                if (!match.sellOrder || !match.buyOrder) {
                    //console.error('Invalid match object:', match);
                    continue;
                }

                const sellOrderAddress = match.sellOrder.sender;
                const buyOrderAddress = match.buyOrder.sender;
                const sellOrderPropertyId = match.sellOrder.offeredPropertyId;
                const buyOrderPropertyId = match.buyOrder.desiredPropertyId;
                
                if(match.sellOrder.blockTime<blockHeight){
                    match.sellOrder.isNew = false
                    match.buyOrder.isNew = true
                }else if(match.sellOrder.blockTime==match.buyOrder.blockTime){
                    match.sellOrder.isNew = true
                    match.buyOrder.isNew = true
                }else{
                    match.buyOrder.isNew = false
                    match.sellOrder.isNew= true
                }

                let takerFee, makerRebate, sellOrderAmountChange, buyOrderAmountChange = 0
                let amountToTradeA = new BigNumber(match.amountOfTokenA)
                let amountToTradeB = new BigNumber(match.amountOfTokenB)

                console.log('amountTo Trade A and B '+ amountToTradeA + ' '+ amountToTradeB + ' '+ 'match values '+ match.amountOfTokenA + ' '+ match.amountOfTokenB)
                // Determine order roles and calculate fees
                if (match.sellOrder.blockTime < match.buyOrder.blockTime) {
                    match.sellOrder.orderRole = 'maker';
                    match.buyOrder.orderRole = 'taker';
                    takerFee = amountToTradeB.times(0.0002);
                    //console.log('taker fee '+takerFee)
                    makerRebate = takerFee.div(2);
                    //console.log('maker fee '+makerRebate)
                    takerFee = takerFee.div(2) //accounting for the half of the taker fee that goes to the maker
                    //console.log(' actual taker fee '+takerFee)
                    await TallyMap.updateFeeCache(buyOrderPropertyId, takerFee.toNumber());
                    //console.log('about to calculate this supposed NaN '+match.amountOfTokenA+' '+new BigNumber(match.amountOfTokenA) + ' '+new BigNumber(match.amountOfTokenA).plus(makerRebate)+ ' '+ new BigNumber(match.amountToTradeA).plus(makerRebate).toNumber)
                    sellOrderAmountChange = new BigNumber(match.amountOfTokenA).plus(makerRebate).toNumber();
                    //console.log('sell order amount change ' +sellOrderAmountChange)
                    buyOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFee).toNumber();

                } else if (match.buyOrder.blockTime < match.sellOrder.blockTime) {
                    match.buyOrder.orderRole = 'maker';
                    match.sellOrder.orderRole = 'taker';
                    takerFee = amountToTradeA.times(0.0002);
                    makerRebate = takerFee.div(2); 
                    takerFee = takerFee.div(2) //accounting for the half of the taker fee that goes to the maker
                    await TallyMap.updateFeeCache(sellOrderPropertyId, takerFee.toNumber());
                    buyOrderAmountChange = new BigNumber(match.amountOfTokenA).plus(makerRebate).toNumber();
                    sellOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFee).toNumber();
                } else if (match.buyOrder.blockTime == match.sellOrder.blockTime) {
                    match.buyOrder.orderRole = 'split';
                    match.sellOrder.orderRole = 'split';
                    var takerFeeA = amountToTradeA.times(0.0001);
                    var takerFeeB = amountToTradeB.times(0.0001);
                    await TallyMap.updateFeeCache(buyOrderPropertyId, takerFeeA.toNumber());
                    await TallyMap.updateFeeCache(sellOrderPropertyId, takerFeeB.toNumber());
                    sellOrderAmountChange = new BigNumber(match.amountOfTokenA).minus(takerFeeA).toNumber();
                    buyOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFeeB).toNumber();
                }

                // Debit the traded amount from the seller's reserve 
                await TallyMap.updateBalance(
                    match.sellOrder.sender,
                    match.sellOrder.offeredPropertyId,
                    0,  // Credit traded amount of Token B to available
                    -match.amountOfTokenA, // Debit the same amount from reserve
                    0, 0,'tokenTrade'
                );
                //and credit the opposite consideration to available

                await TallyMap.updateBalance(
                    match.sellOrder.sender,
                    match.sellOrder.desiredPropertyId,
                    match.amountOfTokenB,  // Credit traded amount of Token B to available
                    0, // Debit the same amount from reserve
                    0, 0,'tokenTrade' 
                );

                // Update balance for the buyer
                // Debit the traded amount from the buyer's reserve and credit it to available
                await TallyMap.updateBalance(
                    match.buyOrder.sender,
                    match.buyOrder.offeredPropertyId,
                    0,  // Credit traded amount of Token B to available
                    -match.amountOfTokenB, // Debit the same amount from reserve
                    0, 0,'tokenTrade' );

                await TallyMap.updateBalance(
                    match.buyOrder.sender,
                    match.buyOrder.desiredPropertyId,
                    match.amountOfTokenA,  // Credit traded amount of Token B to available
                    0, // Debit the same amount from reserve
                    0, 0,'tokenTrade' );

                  // Construct a trade object for recording
                const trade = {
                    offeredPropertyId: match.sellOrder.offeredPropertyId,
                    desiredPropertyId: match.buyOrder.desiredPropertyId,
                    amountOffered: match.amountOfTokenA, // or appropriate amount
                    amountExpected: match.amountOfTokenB, // or appropriate amount
                    // other relevant trade details...
                };

                // Record the token trade
                await this.recordTokenTrade(trade, blockHeight, txid);

            }
        }    

        async addContractOrder(contractId, price, amount, side, insurance, blockTime, txid, sender) {
            const ContractRegistry = require('./contractRegistry.js')
            const inverse = ContractRegistry.isInverse(contractId)
            const MarginMap = require('./marginMap.js')
            const marginMap = await MarginMap.loadMarginMap(contractId);
                         // Get the existing position sizes for buyer and seller
            const existingPosition = await marginMap.getPositionForAddress(sender, contractId);
            // Determine if the trade reduces the position size for buyer or seller
            const isBuyerReducingPosition = Boolean(existingPosition.contracts > 0 &&side==false);
            const isSellerReducingPosition = Boolean(existingPosition.contracts < 0 && side==true);
            //console.log('adding contract order... existingPosition? '+JSON.stringify(existingPosition)+' reducing position? '+isBuyerReducingPosition + ' '+ isSellerReducingPosition)
            let initMargin = 0
            if(isBuyerReducingPosition==false&&isSellerReducingPosition==false){
                //we're increasing or creating a new position so locking up init margin in the reserve column on TallyMap
                //console.log('about to call moveCollateralToMargin '+contractId, amount, sender)
                initMargin = await ContractRegistry.moveCollateralToReserve(sender, contractId, amount, price) //first we line up the capital
            }

            // Create a contract order object with the sell parameter
            const contractOrder = { contractId, amount, price, blockTime, side, initMargin, sender, txid };

            // The orderBookKey is based on the contractId since it's a derivative contract
            const orderBookKey = `${contractId}`;

            // Load the order book for the given contract
            await this.loadOrCreateOrderBook(orderBookKey);

            // Insert the contract order into the order book
            await this.insertOrder(contractOrder, orderBookKey, side);

            // Match orders in the derivative contract order book
            var matchResult = await this.matchContractOrders(orderBookKey);
            if(matchResult.matches !=[]){
                //console.log('contract match result '+JSON.stringify(matchResult))
                await this.processContractMatches(matchResult.matches, blockTime, contractId, inverse)
            }
           
            console.log('about to save orderbook in contract trade '+JSON.stringify(matchResult.matches)+' orderbook '+JSON.stringify(matchResult.orderBook))
            await this.saveOrderBook(orderBookKey);
            return matchResult
        }

        async matchContractOrders(orderBookKey) {
            const orderBook = this.orderBooks[orderBookKey];
            if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
                return { orderBook: this.orderBooks[orderBookKey], matches: [] }; // Return empty matches if no orders
            }

            let matches = [];

            // Sort buy and sell orders by price and time
            orderBook.buy.sort((a, b) => BigNumber(b.price).comparedTo(a.price) || a.time - b.time); // Highest price first
            orderBook.sell.sort((a, b) => BigNumber(a.price).comparedTo(b.price) || a.time - b.time); // Lowest price first

            // Match orders
            while (orderBook.sell.length > 0 && orderBook.buy.length > 0) {
                let sellOrder = orderBook.sell[0];
                let buyOrder = orderBook.buy[0];

                let tradePrice 
                    if(sellOrder.blockTime == buyOrder.blockTime){
                        console.log('contract trades in the same block, defaulting to buy order')
                        tradePrice = buyOrder.price
                    }else{
                        tradePrice = sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
                    }

                // Check for price match
                if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                    // Calculate the amount to be traded
                    let tradeAmount = BigNumber.min(sellOrder.amount, buyOrder.amount);
                    
                    // Update orders after the match
                    sellOrder.amount = BigNumber(sellOrder.amount).minus(tradeAmount).toNumber();
                    buyOrder.amount = BigNumber(buyOrder.amount).minus(tradeAmount).toNumber();

                    // Add match to the list
                    matches.push({ 
                        sellOrder: { ...sellOrder, amount: tradeAmount.toNumber(), sellerAddress: sellOrder.sender, sellerTx: sellOrder.txid }, 
                        buyOrder: { ...buyOrder, amount: tradeAmount.toNumber(), buyerAddress: buyOrder.sender, buyerTx: buyOrder.txid },
                        tradePrice 
                    });

                    // Remove filled orders from the order book
                    if (sellOrder.amount === 0) {
                        orderBook.sell.shift();
                    }
                    if (buyOrder.amount === 0) {
                        orderBook.buy.shift();
                    }
                } else {
                    break; // No more matches possible
                }
            }

            return { orderBook: this.orderBooks[orderBookKey], matches };
        }

        async processContractMatches(matches, currentBlockHeight, inverse) {
            const TallyMap = require('./tally.js');
            if (!Array.isArray(matches)) {
                // Handle the non-iterable case, e.g., log an error, initialize as an empty array, etc.
                console.error('Matches is not an array:', matches);
                matches = []; // Initialize as an empty array if that's appropriate
            }
            const MarginMap = require('./marginMap.js')
            const tradeHistoryManager = new TradeHistory()

            console.log('processing contract mathces '+JSON.stringify(matches))

            for (const match of matches) {

                    if(match.buyOrder.buyerAddress == match.sellOrder.sellerAddress){
                        console.log('self trade nullified '+match.buyOrder.buyerAddress)
                        continue
                    }
                    // Load the margin map for the given series ID and block height
                    const marginMap = await MarginMap.loadMarginMap(match.sellOrder.contractId);
                    console.log('checking the marginMap for contractId '+ marginMap )
                    // Get the existing position sizes for buyer and seller
                    match.buyerPosition = await marginMap.getPositionForAddress(match.buyOrder.buyerAddress, match.buyOrder.contractId);
                    match.sellerPosition = await marginMap.getPositionForAddress(match.sellOrder.sellerAddress, match.buyOrder.contractId);

                    const isBuyerReducingPosition = Boolean(match.buyerPosition.contracts < 0);
                    const isSellerReducingPosition = Boolean(match.sellerPosition.contracts > 0);


                    //now we have a block of ugly code that should be refactored into functions, reuses code for mis-matched margin in moveCollateralToMargin
                    //the purpose of which is to handle flipping positions long to short or visa versa
                    const isBuyerFlippingPosition =  Boolean((match.buyOrder.amount>Math.abs(match.buyerPosition.contracts))&&match.buyerPosition.contracts<0)
                    const isSellerFlippingPosition = Boolean((match.sellOrder.amount>Math.abs(match.sellerPosition.contracts))&&match.sellerPosition.contracts>0)
                    let flipLong = 0 
                    let flipShort = 0
                    let initialMarginPerContract
                    let totalMargin 
                    let collateralPropertyId = ContractRegistry.getCollateralId(match.buyOrder.contractId)
                    if(isBuyerFlippingPosition){
                        flipLong=match.buyOrder.amount-Math.abs(match.buyerPosition.contracts)
                        initialMarginPerContract = await ContractRegistry.getInitialMargin(match.buyOrder.contractId, match.tradePrice);
                        totalMargin = initialMarginPerContract*flipLong
                        TallyMap.hasSufficientBalance(match.buyOrder.buyerAddress, collateralPropertyId,totalMargin)
                        if (!hasSufficientBalance.hasSufficient) {
                        let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                            .dividedBy(initialMarginPerContract)
                            .decimalPlaces(0, BigNumber.ROUND_CEIL)
                            .toNumber();

                        flipLong -= contractUndo;
                        totalInitialMargin = BigNumber(initialMarginPerContract).times(amount).toNumber();
                        
                        }
                        await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, -totalInitialMargin, totalInitialMargin, 0, 0, 'contractReserveInitMargin');
                        await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, 0, -totalInitialMargin, totalInitialMargin, 0, 'contractTradeInitMargin');
                        await marginMap.setInitialMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId, totalInitialMargin);
                    }
                    if(isSellerFlippingPosition){
                        flipShort=match.sellOrder.amount-Math.abs(match.sellerPosition.contracts)
                        initialMarginPerContract = await ContractRegistry.getInitialMargin(match.sellOrder.contractId, match.tradePrice);
                        totalMargin = initialMarginPerContract*flipLong
                        TallyMap.hasSufficientBalance(match.sellOrder.sellerAddress, collateralPropertyId,totalMargin)
                        if (!hasSufficientBalance.hasSufficient) {
                        let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                            .dividedBy(initialMarginPerContract)
                            .decimalPlaces(0, BigNumber.ROUND_CEIL)
                            .toNumber();

                        flipShort -= contractUndo;
                        totalInitialMargin = BigNumber(initialMarginPerContract).times(amount).toNumber();
                        }
                        await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, -totalInitialMargin, totalInitialMargin, 0, 0, 'contractReserveInitMargin');
                        await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, 0, -totalInitialMargin, totalInitialMargin, 0, 'contractTradeInitMargin');
                        await marginMap.setInitialMargin(match.sellOrder.sellerAddress, match.sellOrder.contractId, totalInitialMargin);
                  }

                    if(!isBuyerReducingPosition){
                       // Use the instance method to set the initial margin
                       match.buyerPosition = await ContractRegistry.moveCollateralToMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId,match.buyOrder.amount, match.tradePrice, match.buyOrder.price,true,match.buyOrder.initMargin)

                       console.log('buyer position after moveCollat '+match.buyerPosition)
                    }
                    // Update MarginMap for the contract series
                    if(!isSellerReducingPosition){
                        // Use the instance method to set the initial margin
                       match.sellerPosition = await ContractRegistry.moveCollateralToMargin(match.sellOrder.sellerAddress, match.sellOrder.contractId,match.sellOrder.amount, match.tradePrice,match.sellOrder.price, false, match.sellOrder.initMargin)
                       console.log('sellerPosition after moveCollat '+match.sellerPosition)
                    }


                    console.log('checking position for trade processing '+JSON.stringify(match.buyerPosition) +' buyer size '+' seller size '+JSON.stringify(match.sellerPosition))
                    console.log('reviewing Match object before processing '+JSON.stringify(match))
                    // Update contract balances for the buyer and seller
                    let positions = await marginMap.updateContractBalancesWithMatch(match, false)
                    const trade = {
                        contractId: match.sellOrder.contractId,
                        amount: match.sellOrder.amount,
                        price: match.tradePrice,
                        buyerAddress: match.buyOrder.buyerAddress,
                        sellerAddress: match.sellOrder.sellerAddress,
                        sellerTx: match.sellOrder.sellerTx,
                        buyerTx: match.buyOrder.buyerTx
                        // other relevant trade details...
                    };

                    match.buyerPosition = await marginMap.getPositionForAddress(match.buyOrder.buyerAddress, match.buyOrder.contractId);
                    match.sellerPosition = await marginMap.getPositionForAddress(match.sellOrder.sellerAddress, match.buyOrder.contractId);
                    console.log('checking positions based on mMap vs. return of object in contract update '+JSON.stringify(positions)+' '+JSON.stringify(match.buyerPosition) + ' '+JSON.stringify(match.sellerPosition))

                    console.log('checking positions after contract adjustment, seller '+JSON.stringify(match.sellerPosition) + ' buyer '+JSON.stringify(match.buyerPosition))

                    // Record the contract trade
                    await this.recordContractTrade(trade, currentBlockHeight);
                    // Determine if the trade reduces the position size for buyer or seller
                   
                    const notionalValue = await ContractRegistry.getNotionalValue(match.sellOrder.contractId)
                    const isInverse = await ContractRegistry.isInverse(match.sellOrder.contractId)
                    // Realize PnL if the trade reduces the position size
                    let buyerPnl = 0, sellerPnl = 0;
                    if (isBuyerReducingPosition) {
                        //this loops through our position history and closed/open trades in that history to figure a precise entry price for the trades 
                        //on a LIFO basis that are being retroactively 'closed' by reference here
                        console.log('about to call trade history manager '+match.buyOrder.contractId)
                        const LIFO = tradeHistoryManager.calculateLIFOEntry(match.buyOrder.buyerAddress, match.buyOrder.amount, match.buyOrder.contractId)
                        //{AvgEntry,blockTimes}
                        let avgEntry = LIFO.totalCost/match.buyOrder.amount 
                        //then we take that avg. entry price, not for the whole position but for the chunk that is being closed
                        //and we figure what is the PNL that one would show on their taxes, to save a record.
                        const accountingPNL = marginMap.realizePnl(match.buyOrder.buyerAddress, match.buyOrder.amount, match.tradePrice, avgEntry, true, notionalValue, match.buyerPosition);
                        //then we will look at the last settlement mark price for this contract or default to the LIFO Avg. Entry if
                        //the closing trade and the opening trades reference happened in the same block (exceptional, will add later)
                        
                        const settlementPNL = marginMap.settlePNL(match.buyOrder.buyerAddress, match.buyOrder.amount, match.buyOrder.price, LIFO, match.buyOrder.contractId, currentBlockHeight) 
                        //then we figure out the aggregate position's margin situation and liberate margin on a pro-rata basis 
                        console.log('position before going into reduce Margin '+JSON.stringify(match.buyerPosition))
                        const reduction = await marginMap.reduceMargin(match.buyerPosition, match.buyOrder.amount, accountingPNL /*settlementPNL*/, isInverse,match.buyOrder.contractId, match.buyOrder.buyerAddress);
                        //{netMargin,mode}   

                        await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, reduction.netMargin, 0, -reduction.netMargin, 0, 'contractTradeSettlement')              
                        //then we move the settlementPNL out of margin assuming that the PNL is not exactly equal to maintainence margin
                        //the other modes (for auditing/testing) would be, PNL is positive and you get back init. margin 'profit'
                        //PNL is positive and you get back some fraction of the init. margin that was previously settled out 'fractionalProfit'
                        //PNL is negative and you get back more than maint. margin but of course less than init. margin 'moreThanMaint'
                        //PNL is negative and you get back <= maintainence margin which hasn't yet cleared/topped-up 'lessThanMaint'
                        //PNL is negative and all the negative PNL has exactly matched the maintainence margin which won't need to be topped up,
                        //unusual edge case but we're covering it here 'maint'
                        //also if this trade realizes a loss that wipes out all maint. margin that we have to look at available balance and go for that
                        //if there's not enough available balance then we have to go to the insurance fund, or we add the loss to the system tab for
                        //socialization of losses at settlement, and I guess flag something so future rPNL profit calculations get held until settlement
                        if(reduction.mode!='maint'){
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, accountingPNL/*settlementPNL*/, 0, -accountingPNL/*-settlementPNL*/, 0, 'contractTradeSettlement');
                        } 
                        if(reduction.mode=='shortfall'){
                            //check the address available balance for the neg. balance
                            //if there's enough in available then do a tallyMap shuffle
                            //otherwise go to insurance or maybe post a system loss at the bankruptcy price and see if it can get cleared before tapping the ins. fund
                        }

                        
                        const savePNLParams = {height:currentBlockHeight, contractId:match.buyOrder.contractId, accountingPNL: accountingPNL, 
                            address: match.buyOrder.buyerAddress, amount: match.buyOrder.amount, tradePrice: match.buyOrder.price, collateralPropertyId: collateralPropertyId,
                            timestamp: new Date().toISOString(), txid: match.buyOrder.buyerTx, settlementPNL: settlementPNL, marginReduction:reduction, LIFOAvgEntry: avgEntry}
                        console.log('preparing to call savePNL with params '+JSON.stringify(savePNLParams))
                        tradeHistoryManager.savePNL(savePNLParams)
                    }

                    if (isSellerReducingPosition) {
                        //this loops through our position history and closed/open trades in that history to figure a precise entry price for the trades 
                        //on a LIFO basis that are being retroactively 'closed' by reference here
                        console.log('position before going into LIFO '+JSON.stringify(match.sellerPosition))
                        console.log('about to call trade history manager '+match.sellOrder.contractId)
                        const LIFO = await tradeHistoryManager.calculateLIFOEntry(match.sellOrder.sellerAddress, match.sellOrder.amount, match.sellOrder.contractId)
                        let avgEntry = LIFO.totalCost/match.sellOrder.amount 
                        //{AvgEntry,blockTimes} 
                        //then we take that avg. entry price, not for the whole position but for the chunk that is being closed
                        //and we figure what is the PNL that one would show on their taxes, to save a record.
                        console.log('LIFO '+JSON.stringify(LIFO))

                        console.log('position before realizePnl '+JSON.stringify(match.sellerPosition))
                        const accountingPNL = marginMap.realizePnl(match.sellOrder.sellerAddress, match.sellOrder.amount, match.tradePrice, avgEntry, isInverse, notionalValue, match.sellerPosition);
                       //then we will look at the last settlement mark price for this contract or default to the LIFO Avg. Entry if
                        //the closing trade and the opening trades reference happened in the same block (exceptional, will add later)
                        
                        console.log('position before settlePNL '+JSON.stringify(match.sellerPosition))
                        const settlementPNL = marginMap.settlePNL(match.sellOrder.sellerAddress, match.sellOrder.amount, match.tradePrice, LIFO, match.sellOrder.contractId,currentBlockHeight) 
                        //then we figure out the aggregate position's margin situation and liberate margin on a pro-rata basis 
                        console.log('position before going into reduce Margin '+JSON.stringify(match.sellerPosition))
                        const reduction = await marginMap.reduceMargin(match.sellerPosition, match.sellOrder.amount, accountingPNL/*settlementPNL*/, isInverse, match.sellOrder.contractId, match.sellOrder.sellerAddress);
                        //{netMargin,mode}   

                        await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, reduction.netMargin, 0, -reduction.netMargin, 0, 'contractTradeSettlement')              
                        //then we move the settlementPNL out of margin assuming that the PNL is not exactly equal to maintainence margin
                        //the other modes (for auditing/testing) would be, PNL is positive and you get back init. margin 'profit'
                        //PNL is positive and you get back some fraction of the init. margin that was previously settled out 'fractionalProfit'
                        //PNL is negative and you get back more than maint. margin but of course less than init. margin 'moreThanMaint'
                        //PNL is negative and you get back <= maintainence margin which hasn't yet cleared/topped-up 'lessThanMaint'
                        //PNL is negative and all the negative PNL has exactly matched the maintainence margin which won't need to be topped up,
                        //unusual edge case but we're covering it here 'maint'
                        if(reduction.mode!='maint'){
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, accountingPNL/*settlementPNL*/, 0, -accountingPNL, 0, 'contractTradeSettlement');
                        } 
                       const savePNLParams = {height:currentBlockHeight, contractId:match.sellOrder.contractId, accountingPNL: accountingPNL, 
                            address: match.sellOrder.sellerAddress, amount: match.sellOrder.amount, tradePrice: match.sellOrder.price, collateralPropertyId: collateralPropertyId,
                            timestamp: new Date().toISOString(), txid: match.sellOrder.sellerTx, settlementPNL: settlementPNL, marginReduction:reduction, LIFOAvgEntry: avgEntry}
                        console.log('preparing to call savePNL with params '+JSON.stringify(savePNLParams))
                        tradeHistoryManager.savePNL(savePNLParams)
                    }
                    //console.log('params before calling updateMargin '+match.buyOrder.contractId,match.buyOrder.buyerAddress,match.buyOrder.amount, match.buyOrder.price)
                    // Update margin based on the new positions
                    //marginMap.updateMargin(match.buyOrder.contractId, match.buyOrder.buyerAddress, match.buyOrder.amount, match.buyOrder.price, inverse);
                    //marginMap.updateMargin(match.sellOrder.contractId, match.sellOrder.sellerAddress, -match.sellOrder.amount, match.sellOrder.price, inverse);

                    // Save the updated margin map
                    await marginMap.saveMarginMap(false);

                    console.log('checking match object before writing trade data obj '+JSON.stringify(match)+ ' what this looks like inside sellOrder contractid '+ match.sellOrder.contractId+' amount '+match.sellOrder.amount)
                    // Construct a trade object for recording

                        // Optionally handle the PnL if needed, e.g., logging or further processing
                    // ...    
            }
        }

        async cancelOrdersByCriteria(fromAddress, orderBookKey, criteria, token) {
            await this.loadOrCreateOrderBook(orderBookKey,true)
            //console.log('canceling for key ' +orderBookKey)
            const orderBook = this.orderBooks[orderBookKey]; // Assuming this is the correct reference
            const cancelledOrders = [];
            let returnFromReserve = 0
            if(!token){
                console.log('showing orderbook before cancel '+JSON.stringify(orderBook))
            }
            if(orderBook==undefined){
                console.log('orderbook undefined, maybe empty ')
                return []
            }

            if(criteria.txid!=undefined){
                //console.log('cancelling by txid '+criteria.txid)
              for (let i = orderBook.buy.length - 1; i >= 0; i--) {
                const ord = orderBook.buy[i]
                if(ord.txid === criteria.txid){
                        cancelledOrders.push(ord);

                        //console.log('splicing order '+JSON.stringify(ord))
                        orderBook.buy.splice(i, 1);
                }
               }

               for (let i = orderBook.sell.length - 1; i >= 0; i--) {
                const ordi = orderBook.sell[i]
                if(ordi.txid === criteria.txid){
                    //console.log('splicing orders out for cancel by txid '+JSON.stringify(ordi))
                        cancelledOrders.push(ordi);

                        //console.log('splicing order '+JSON.stringify(ordi))
                        orderBook.buy.splice(i, 1);
                }
               }

            }else{
                      //console.log('orderbook prior to cancelling '+JSON.stringify(orderBook))
                for (let i = orderBook.buy.length - 1; i >= 0; i--) {

                    const order = orderBook.buy[i];
                    
                    if(this.shouldCancelOrder(order,criteria)){
                         // Logic to cancel the order
                            cancelledOrders.push(order);

                            console.log('splicing order '+JSON.stringify(order))
                            orderBook.buy.splice(i, 1);

                            if(token==true){
                                returnFromReserve+=order.amountOffered
                            }else{
                                returnFromReserve+=order.initMargin
                            }
                    }
                }

                //console.log('orderbook sellside '+JSON.stringify(orderBook.sell))
                for (let i = orderBook.sell.length - 1; i >= 0; i--) {
                    const order = orderBook.sell[i];

                    if(this.shouldCancelOrder(order,criteria)){
                            //if(criteria.address=="tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"){console.log('canceling all')}
                         // Logic to cancel the order
                            cancelledOrders.push(order);
                            console.log('splicing order '+JSON.stringify(order))
                            orderBook.sell.splice(i, 1);

                            if(token==true){
                                returnFromReserve+=order.amountOffered
                            }else{
                                returnFromReserve+=order.initMargin
                            }
                    }
                }

            }
          
            console.log('returning tokens from reserve '+returnFromReserve)
            cancelledOrders.returnFromReserve=returnFromReserve
            // Save the updated order book to the database

            this.orderBooks[orderBookKey] = orderBook
            console.log('orderbook after cancel operation '+JSON.stringify(this.orderBooks[orderBookKey]))
            await this.saveOrderBook(orderBookKey);

            // Log the cancellation for record-keeping
            //console.log(`Cancelled orders: ${JSON.stringify(cancelledOrders)}`);

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        shouldCancelOrder(order, criteria) {
            /*if (!order || !order.senderAddess) {
                console.error('Invalid order:', order);
                return false;
            }*/
            console.log('should cancel order? '+JSON.stringify(order)+' '+JSON.stringify(criteria))
            console.log('cancel all criteria '+JSON.stringify(criteria.address!=undefined)+' '+JSON.stringify(order.sender===criteria.address))
            if(criteria.price!=undefined&&(criteria.buy ? order.price <= criteria.price : order.price >= criteria.price)){
                return true
            }
            if (criteria.address!=undefined && order.sender === criteria.address) {
                return true;
            }

            return false;
        }

        async cancelAllContractOrders(fromAddress, offeredPropertyId) {
            const TallyMap = require('./tally.js')
            // Logic to cancel all contract orders
            // Retrieve relevant order details and calculate margin reserved amounts
            const criteria = { address: fromAddress }; // Criteria to cancel all orders for a specific address
            const key = offeredPropertyId
            console.log('about to call cancelOrdersByCriteria in cancelAllContractOrders '+fromAddress, key, criteria)
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);
            const collateralPropertyId = await ContractRegistry.getCollateralId(offeredPropertyId);
            console.log('returning from reserve '+cancelledOrders.returnFromReserve)
            for (const order of cancelledOrders) {
                console.log('applying reserve changes for cancelled order '+JSON.stringify(order))
                const reserveAmount = order.initMargin
                console.log('about to apply changes '+reserveAmount)
                await TallyMap.updateBalance(fromAddress, collateralPropertyId, +reserveAmount, -reserveAmount,0,0,'contractCancel');
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelContractOrderByTxid (fromAddress, offeredPropertyId, txid) {
            const TallyMap = require('./tally.js')
            // Logic to cancel a specific contract order by txid
            // Retrieve order details and calculate margin reserved amount
            const criteria = { txid: txid }; // Criteria to cancel orders by txid
            const key = offeredPropertyId
            const cancelledOrder = await this.cancelOrdersByCriteria(fromAddress, key, criteria);
            //console.log('cancelling order '+JSON.stringify(cancelledOrder)+' cancelled order price '+cancelledOrder[0].price)
            const initMarginPerContract = await ContractRegistry.getInitialMargin(offeredPropertyId, cancelledOrder[0].price);
            //console.log('about to calculate reserveAmount '+cancelledOrder[0].amount + ' '+initMarginPerContract)
            const reserveAmount = cancelledOrder[0].initMargin
            const collateralPropertyId = await ContractRegistry.getCollateralId(offeredPropertyId)
            //console.log('about to move reserve back to available cancelling contract order by txid '+reserveAmount +' '+collateralPropertyId)
            await TallyMap.updateBalance(fromAddress, collateralPropertyId, reserveAmount, -reserveAmount,0,0,'contractCancel');

            // Return the details of the cancelled order
            return cancelledOrder;
        }

        async cancelContractBuyOrdersByPrice(fromAddress, offeredPropertyId, price, buy) {
            const TallyMap = require('./tally.js')
            const criteria = { price: price, buy: false }; // Criteria to cancel sell orders by price
            const key = offeredPropertyId
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);

            const collateralPropertyId = await ContractRegistry.getCollateralId(offeredPropertyId);

            for (const order of cancelledOrders) {
                const reserveAmount = order.initMargin 
                await TallyMap.updateBalance(fromAddress, collateralPropertyId, reserveAmount, -reserveAmount,0,0,'contractCancel');
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelAllTokenOrders(fromAddress, offeredPropertyId, desiredPropertyId) {
            const TallyMap = require('./tally.js')
            // Logic to cancel all token orders
            // Retrieve relevant order details and calculate margin reserved amounts
            const criteria = { address: fromAddress }; // Criteria to cancel all orders for a specific address
            const key =  offeredPropertyId+'-'+desiredPropertyId
            //console.log('cancelAllTokenOrders key'+key)
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);

            for (const order of cancelledOrders) {
                const reserveAmount = order.amountOffered;
                //console.log('cancelling orders in cancelAll token orders '+JSON.stringify(order)+' '+reserveAmount)
                await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel');
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelTokenOrderByTxid(fromAddress, offeredPropertyId, desiredPropertyId, txid) {
            const TallyMap = require('./tally.js')
            // Logic to cancel a specific token order by txid
            // Retrieve order details and calculate margin reserved amount
            const key =  offeredPropertyId+'-'+desiredPropertyId
            const cancelledOrder = await this.cancelOrdersByCriteria(fromAddress, key, {txid:txid});
            const reserveAmount = order.amountOffered;
            await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel');

            // Return the details of the cancelled order
            return cancelledOrder;
        }

        async cancelTokenBuyOrdersByPrice(fromAddress, offeredPropertyId, desiredPropertyId, price) {
            const TallyMap = require('./tally.js')
            // Logic to cancel token buy orders by price
            // Retrieve relevant buy orders and calculate margin reserved amounts
            const key =  offeredPropertyId+'-'+desiredPropertyId
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, {price:price, buy:true});

            for (const order of cancelledOrders) {
                const reserveAmount = order.amountOffered;
                await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel');
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelTokenSellOrdersByPrice(fromAddress, offeredPropertyId, desiredPropertyId, price) {
            const TallyMap = require('./tally.js')
            // Logic to cancel token sell orders by price
            // Retrieve relevant sell orders and calculate margin reserved amounts
            const key =  offeredPropertyId+'-'+desiredPropertyId
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, {price:price, buy:false});

            for (const order of cancelledOrders) {
                const reserveAmount = order.amountOffered;
                await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel');
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }
           
        async getOrdersForAddress(address, contractId, offeredPropertyId, desiredPropertyId) {
            const orderbookId = contractId ? contractId.toString() : `${offeredPropertyId}-${desiredPropertyId}`;

            try {
                // Load or create order book data
                await this.loadOrCreateOrderBook(orderbookId);

                const orderbookData = this.orderBooks[orderbookId];
                const { buy, sell } = orderbookData;

                if (!buy || !sell) {
                    return []; // Return an empty array if buy or sell data is missing
                }

                // Filter buy orders for the given address
                const buyOrders = buy.filter(order => order.sender === address);

                // Filter sell orders for the given address
                const sellOrders = sell.filter(order => order.sender === address);

                // Concatenate buy and sell orders and return the result
                return buyOrders.concat(sellOrders);
            } catch (error) {
                console.error('Error getting orders for address:', error);
                return []; // Return an empty array in case of an error
            }
        }

        // Function to return the current state of the order book for the given key
        getOrderBookData() {
            return this.orderBooks[this.orderBookKey];
        }
}

module.exports = Orderbook;
