const BigNumber = require('bignumber.js')
const dbInstance = require('./db.js'); // Import your database instance
const { v4: uuidv4 } = require('uuid');  // Import the v4 function from the uuid library
const TradeHistory = require('./tradeHistoryManager.js')
const ContractRegistry = require('./contractRegistry.js')
const VolumeIndex= require('./volumeIndex.js')
const Channels = require('./channels.js')
const ClearList = require('./clearlist.js')

class Orderbook {
      constructor(orderBookKey, tickSize = new BigNumber('0.00000001')) {
            this.tickSize = tickSize;
            this.orderBookKey = orderBookKey; // Unique identifier for each orderbook (contractId or propertyId pair)
            this.orderBooks = {};
            //this.loadOrderBook(); // Load or create an order book based on the orderBookKey
        }
         // Static async method to get an instance of Orderbook
        static async getOrderbookInstance(orderBookKey) {
            const orderbook = new Orderbook(orderBookKey);
            this.orderBooks= await orderbook.loadOrderBook(orderBookKey); // Load or create the order book
            return orderbook;
        }

         async loadOrderBook(key,contract) {
                const stringKey = typeof key === 'string' ? key : String(key);
                const orderBooksDB = await dbInstance.getDatabase('orderBooks');

                try {
                    const orderBookData = await orderBooksDB.findOneAsync({ _id: stringKey });
                    if (orderBookData && orderBookData.value) {
                        const parsedOrderBook = JSON.parse(orderBookData.value);
                        this.orderBooks[key] = parsedOrderBook;
                        if(contract){
                            console.log('loading the orderbook for ' + key + ' in the form of ' + JSON.stringify(parsedOrderBook.buy));
                        }
                        return parsedOrderBook; // Return the parsed order book
                    } else {
                        console.log('new orderbook for ' + key);
                        return { buy: [], sell: [] };
                    }
                } catch (error) {
                    console.error('Error loading or parsing order book data:', error);
                    return { buy: [], sell: [] }; // Return an empty order book on error
                }
            }


        async saveOrderBook(orderbookData, key) {
            console.log('saving orderbook with key '+key)
            if(key==undefined){
                return console.log('orderbook save failed with undefined key')
            }
            const orderBooksDB = await dbInstance.getDatabase('orderBooks');
            await orderBooksDB.updateAsync(
                { _id: key },
                { _id: key, value: JSON.stringify(orderbookData) },
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
            //console.log('saving contract trade ' +JSON.stringify(trade))
            await this.saveTrade(tradeRecord);
        }

        async saveTrade(tradeRecord) {
            const tradeDB =await dbInstance.getDatabase('tradeHistory');

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
                //console.log(`Trade record saved successfully: ${tradeId}`);
            } catch (error) {
                //console.error(`Error saving trade record: ${tradeId}`, error);
                throw error; // Rethrow the error for handling upstream
            }
        }

        // Retrieve token trading history by propertyId pair
        static async getTokenTradeHistoryByPropertyIdPair(propertyId1, propertyId2) {
                const tradeDB = await dbInstance.getDatabase('tradeHistory');
                const tradeRecordKey = `token-${propertyId1}-${propertyId2}`;
                const trades = await tradeDB.findAsync({ key: tradeRecordKey });
                return trades.map(doc => doc.trade);
        }

        // Retrieve contract trading history by contractId
        static async getContractTradeHistoryByContractId(contractId) {
                //console.log('loading trade history for '+contractId)
                const tradeDB = await dbInstance.getDatabase('tradeHistory');
                const tradeRecordKey = `contract-${contractId}`;
                const trades = await tradeDB.findAsync({ key: tradeRecordKey });
                return trades.map(doc => doc.trade);
        }

        // Retrieve trade history by address for both token and contract trades
        static async getTradeHistoryByAddress(address) {
                const tradeDB = await dbInstance.getDatabase('tradeHistory');
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
            await TallyMap.updateBalance(order.sender, order.offeredPropertyId, -order.amountOffered, order.amountOffered, 0, 0,'tokenOrder',blockHeight);
            
            // Determine the correct orderbook key
            const normalizedOrderBookKey = this.normalizeOrderBookKey(order.offeredPropertyId, order.desiredPropertyId);
            //console.log('Normalized Order Book Key:', normalizedOrderBookKey);
           
            // Create an instance of Orderbook for the pair and load its data
            const orderbook = new Orderbook(normalizedOrderBookKey);
            var orderbookData = await orderbook.loadOrderBook(normalizedOrderBookKey,false);
            //console.log('loaded orderbook' +JSON.stringify(orderbookData))
            // Calculate the price for the order and round to the nearest tick interval
            const calculatedPrice = this.calculatePrice(order.amountOffered, order.amountExpected);
            console.log('Calculated Token  Price:' + calculatedPrice+' '+txid);
            order.price = calculatedPrice; // Append the calculated price to the order object
            order.txid= txid.slice(0,3)+txid.slice(-4)

            // Determine if the order is a sell order
            const isSellOrder = Boolean(order.offeredPropertyId < order.desiredPropertyId);

            // Add the order to the orderbook
            orderbookData = await orderbook.insertOrder(order, orderbookData, isSellOrder,false);
            //console.log('Order Insertion Confirmation:', orderbookData);

            // Match orders in the orderbook
            const matchResult = await orderbook.matchTokenOrders(orderbookData);
            if (matchResult.matches && matchResult.matches.length > 0) {
                //console.log('Match Result:', matchResult);
                await orderbook.processTokenMatches(matchResult.matches, blockHeight, txid, false);
            }else{console.log('No Matches for ' +txid)}
            console.log('Normalized Order Book Key before saving:', normalizedOrderBookKey);
            //console.log('getting ready to save orderbook update '+JSON.stringify(matchResult.orderBook))
            // Save the updated orderbook back to the database
            await orderbook.saveOrderBook(matchResult.orderBook,normalizedOrderBookKey);

            return matchResult;
        }

        normalizeOrderBookKey(propertyId1, propertyId2) {
            // Ensure lower property ID is first in the key
            return propertyId1 < propertyId2 ? `${propertyId1}-${propertyId2}` : `${propertyId2}-${propertyId1}`;
        }

       async insertOrder(order, orderbookData, isSellOrder, isLiq) {

            if (typeof orderbookData === 'string') {
                try {
                    orderbookData = JSON.parse(orderbookData);
                } catch (e) {
                    console.error('Failed to parse orderbook data:', orderbookData);
                    return; // Exit if parsing fails to prevent further issues
                }
            }

            /*if (!this.isValidOrderbook(orderbookData,contract)) {

 
 +                    console.error('Invalid orderbook data:', JSON.stringify(orderbookData));
                return orderbookData; // Return early to avoid corrupting the orderbook
            }*/
            if (!orderbookData) {
                orderbookData = { buy: [], sell: [] };
            }

            // Log the current state for debugging
            //console.log('Order:', JSON.stringify(order));
            //console.log('Orderbook data before:', JSON.stringify(orderbookData));
            //console.log('Is sell order:', isSellOrder);

            // Determine the side of the order
            //console.log('is sell?'+isSellOrder)
            const side = isSellOrder ? 'sell' : 'buy';
            //console.log('side '+side)
            let bookSide = orderbookData[side];
            //console.log('book side '+JSON.stringify(bookSide))
            // Ensure bookSide is initialized if undefined
            if (!bookSide) {
                bookSide = [];
            }

            // Log the state of bookSide for debugging
            //console.log('Book side before:', JSON.stringify(bookSide));

            // Find the appropriate index to insert the new order
            const index = bookSide.findIndex((o) => o.time > order.time);
            if (index === -1) {
                bookSide.push(order); // Append to the end if no larger time is found
            } else {
                bookSide.splice(index, 0, order); // Insert at the found index
            }

            // Reintegrate bookSide back into orderbookData correctly
            orderbookData[side] = bookSide;

            // Log the updated orderbookData for debugging
            //console.log('Updated orderbook data:', JSON.stringify(orderbookData));

            return orderbookData;
        }

        isValidOrderbook(data,contract) {
            if (typeof data !== 'object' || data === null) return false;

            const hasBuySell = data.hasOwnProperty('buy') && data.hasOwnProperty('sell');
            const isValidBuyArray = Array.isArray(data.buy) && (data.buy.length === 0 || data.buy.every(this.isValidOrder,contract));
            const isValidSellArray = Array.isArray(data.sell) && (data.sell.length === 0 || data.sell.every(this.isValidOrder,contract));

            console.log(isValidBuyArray, isValidSellArray)
            console.log(data.buy.length===0, data.sell.length===0)


            return hasBuySell && isValidBuyArray && isValidSellArray;
        }

       isValidOrder(order, contract) {
            const hasRequiredFields = order.hasOwnProperty('offeredPropertyId') &&
                order.hasOwnProperty('desiredPropertyId') &&
                order.hasOwnProperty('amountOffered') &&
                order.hasOwnProperty('amountExpected') &&
                order.hasOwnProperty('blockTime') &&
                order.hasOwnProperty('sender') &&
                order.hasOwnProperty('price');

            const hasValidTypes = typeof order.offeredPropertyId === 'number' &&
                typeof order.desiredPropertyId === 'number' &&
                typeof order.amountOffered === 'number' &&
                typeof order.amountExpected === 'number' &&
                typeof order.blockTime === 'number' &&
                typeof order.sender === 'string' &&
                typeof order.price === 'number';

            if (contract==true||contract==null) {
                const hasContractFields = order.hasOwnProperty('contractId') &&
                    order.hasOwnProperty('amount') &&
                    order.hasOwnProperty('side') &&
                    order.hasOwnProperty('initMargin') &&
                    order.hasOwnProperty('txid') &&
                    order.hasOwnProperty('isLiq') &&
                    order.hasOwnProperty('reduce') &&
                    order.hasOwnProperty('post');

                const hasValidContractTypes = typeof order.contractId === 'number' &&
                    typeof order.amount === 'number' &&
                    typeof order.side === 'boolean' &&
                    typeof order.initMargin === 'number' &&
                    typeof order.txid === 'string' &&
                    typeof order.isLiq === 'boolean' &&
                    typeof order.reduce === 'boolean' &&
                    typeof order.post === 'boolean';

                return hasContractFields && hasValidContractTypes;
            }

            return hasRequiredFields && hasValidTypes;
        }


        calculatePrice(amountOffered, amountExpected) {
            const priceRatio = new BigNumber(amountOffered).dividedBy(amountExpected);
            //console.log('price ratio '+priceRatio)
            return priceRatio.decimalPlaces(8, BigNumber.ROUND_HALF_UP).toNumber();
        }

        async matchTokenOrders(orderbookData) {
            if (!orderbookData) {
                return { orderBook: { buy: [], sell: [] }, matches: [] }; // Return empty matches
            }

            // Make a deep copy of the orderbookData to avoid unintended mutations
            let orderBookCopy = JSON.parse(JSON.stringify(orderbookData));

            let matches = [];

            // Sort buy and sell orders
            orderBookCopy.buy.sort((a, b) => BigNumber(b.price).comparedTo(a.price) || a.blockTime - b.blockTime); // Highest price first
            orderBookCopy.sell.sort((a, b) => BigNumber(a.price).comparedTo(b.price) || a.blockTime - b.blockTime); // Lowest price first

            //console.log('orderbook inside match orders ' + JSON.stringify(orderBookCopy));

            let counter = 0

            // Match orders
            while (orderBookCopy.sell.length > 0 && orderBookCopy.buy.length > 0) {
                counter+=1
                //console.log(counter, JSON.stringify(orderBookCopy))
                let sellOrder = orderBookCopy.sell[0];
                let buyOrder = orderBookCopy.buy[0];



                // Ensure matching distinct property IDs
                if (sellOrder.offeredPropertyId === buyOrder.desiredPropertyId && sellOrder.desiredPropertyId === buyOrder.offeredPropertyId) {
                    let tradePrice;
                    let bumpTrade = false;
                    let post = false;
                    sellOrder.maker = false
                    buyOrder.maker = false

                    // Handle trades in the same block
                    if (sellOrder.blockTime === buyOrder.blockTime) {
                        console.log('trades in the same block, defaulting to buy order');
                        tradePrice = buyOrder.price;
                        if (sellOrder.post) {
                            tradePrice = sellOrder.price;
                            post = true;
                            sellOrder.maker=true
                        } else if (buyOrder.post) {
                            tradePrice = buyOrder.price;
                            post = true;
                            buyOrder.maker=true
                        }
                        sellOrder.flat=true
                    } else {
                        tradePrice = sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
                        if ((sellOrder.blockTime < buyOrder.blockTime && buyOrder.post) || 
                            (buyOrder.blockTime < sellOrder.blockTime && sellOrder.post)) {
                            bumpTrade = true;
                        }
                        if((sellOrder.blockTime < buyOrder.blockTime&&bumpTrade==false)){
                            sellOrder.maker=true
                        }else if(sellOrder.blockTime > buyOrder.blockTime&&bumpTrade==false){
                            buyOrder.maker=true
                        }
                    }

                     if (sellOrder.sender === buyOrder.sender) {
                            // Remove the maker order from the book
                            if (sellOrder.maker) {
                                orderBookCopy.sell.shift();
                                console.log('bumping sell order as a self-trade maker'+JSON.stringify(sellOrder))
                                console.log(JSON.stringify(orderBookCopy))
                            } else if (buyOrder.maker) {
                                orderBookCopy.buy.shift();
                                console.log('bumping buy order as a self-trade maker'+JSON.stringify(buyOrder) )

                            }
                            continue
                        }

                    // Check for price match
                    if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                        let sellAmountOffered = new BigNumber(sellOrder.amountOffered);
                        let sellAmountExpected = new BigNumber(sellOrder.amountExpected);
                        let buyAmountOffered = new BigNumber(buyOrder.amountOffered);
                        let buyAmountExpected = new BigNumber(buyOrder.amountExpected);

                        let tradeAmountA = BigNumber.min(sellAmountOffered, buyAmountExpected);
                        let tradeAmountB = tradeAmountA.times(tradePrice);

                        console.log('checking values for order amounts ', sellOrder.amountOffered, buyOrder.amountExpected, sellAmountOffered, buyAmountExpected);
                        console.log('trade amounts ', tradeAmountA, tradeAmountB);

                        if (!bumpTrade) {
                            sellOrder.amountOffered = sellAmountOffered.minus(tradeAmountA).toNumber();
                            buyOrder.amountOffered = buyAmountOffered.minus(tradeAmountB).toNumber();
                            sellOrder.amountExpected = sellAmountExpected.minus(tradeAmountB).toNumber();
                            buyOrder.amountExpected = buyAmountExpected.minus(tradeAmountA).toNumber();

                            matches.push({
                                sellOrder: { ...sellOrder, amountOffered: tradeAmountA.toNumber() },
                                buyOrder: { ...buyOrder, amountExpected: tradeAmountB.toNumber() },
                                amountOfTokenA: tradeAmountA.toNumber(),
                                amountOfTokenB: tradeAmountB.toNumber(),
                                tradePrice,
                                post,
                                bumpTrade
                            });

                            if (sellOrder.amountOffered === 0) {
                                orderBookCopy.sell.shift();
                            } else {
                                orderBookCopy.sell[0] = sellOrder;
                            }

                            if (buyOrder.amountExpected === 0) {
                                orderBookCopy.buy.shift();
                            } else {
                                orderBookCopy.buy[0] = buyOrder;
                            }
                        } else {
                            if (buyOrder.post) {
                                buyOrder.price = sellOrder.price - this.tickSize;
                            }
                            if (sellOrder.post) {
                                sellOrder.price = buyOrder.price + this.tickSize;
                            }
                        }
                    } else {
                        break; // No more matches possible
                    }
                } else {
                    // Orders do not have matching property IDs, break the loop
                    break;
                }
            }

            //console.log('Final orderBookCopy before returning: ' + JSON.stringify(orderBookCopy));
            return { orderBook: orderBookCopy, matches: matches };
        }



        async processTokenMatches(matches, blockHeight, txid, channel) {
            const TallyMap = require('./tally.js');
            if (!Array.isArray(matches) || matches.length === 0) {
                //console.log('No valid matches to process');
                return;
            }

             //see if the trade qualifies for increased Liquidity Reward
          

            for (const match of matches) {
                if (!match.sellOrder || !match.buyOrder) {
                    //console.error('Invalid match object:', match);
                    continue;
                }

                const sellOrderAddress = match.sellOrder.sender;
                const buyOrderAddress = match.buyOrder.sender;
                const sellOrderPropertyId = match.sellOrder.desiredPropertyId;
                const buyOrderPropertyId = match.buyOrder.desiredPropertyId;
                console.log('checking params in process token match '+buyOrderPropertyId+' '+sellOrderPropertyId)
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
                if(channel==true){
                    amountToTradeA = new BigNumber(match.sellOrder.amountOffered)
                    amountToTradeB = new BigNumber(match.buyOrder.amountExpected)
                }
                console.log('amountTo Trade A and B '+ amountToTradeA + ' '+ amountToTradeB + ' '+ 'match values '+ match.amountOfTokenA + ' '+ match.amountOfTokenB)
                // Determine order roles and calculate fees
                if ((match.sellOrder.blockTime < match.buyOrder.blockTime)&&channel==false) {
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

                } else if((match.buyOrder.blockTime < match.sellOrder.blockTime)&&channel==false){
                    match.buyOrder.orderRole = 'maker';
                    match.sellOrder.orderRole = 'taker';
                    takerFee = amountToTradeA.times(0.0002);
                    makerRebate = takerFee.div(2); 
                    takerFee = takerFee.div(2) //accounting for the half of the taker fee that goes to the maker
                    await TallyMap.updateFeeCache(sellOrderPropertyId, takerFee.toNumber());
                    buyOrderAmountChange = new BigNumber(match.amountOfTokenA).plus(makerRebate).toNumber();
                    sellOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFee).toNumber();
                } else if (((match.buyOrder.blockTime == match.sellOrder.blockTime)&&(match.sellOrder.post==false&&match.sellOrder.post==false))||channel==true){
                    match.buyOrder.orderRole = 'split';
                    match.sellOrder.orderRole = 'split';
                    var takerFeeA = amountToTradeA.times(0.0001);
                    var takerFeeB = amountToTradeB.times(0.0001);
                    await TallyMap.updateFeeCache(buyOrderPropertyId, takerFeeA.toNumber());
                    await TallyMap.updateFeeCache(sellOrderPropertyId, takerFeeB.toNumber());
                    sellOrderAmountChange = new BigNumber(match.amountOfTokenA).minus(takerFeeA).toNumber();
                    buyOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFeeB).toNumber();
                }
                console.log('about to update tallymap in process token trade '+match.sellOrder.sender +' '+match.buyOrder.sender +' '+match.channel)
                await TallyMap.updateBalance(
                        match.sellOrder.sender,
                        match.sellOrder.desiredPropertyId,
                        match.amountOfTokenB,  // Credit traded amount of Token B to available
                        0, // Debit the same amount from reserve
                        0, 0,'tokenTrade',blockHeight 
                );


                await TallyMap.updateBalance(
                        match.buyOrder.sender,
                        match.buyOrder.desiredPropertyId,
                        match.amountOfTokenA,  // Credit traded amount of Token B to available
                        0, // Debit the same amount from reserve
                        0, 0,'tokenTrade',blockHeight);

                if(channel==true){
                    await TallyMap.updateChannelBalance(
                        match.channel,
                        match.sellOrder.offeredPropertyId,
                        -match.amountOfTokenA,
                        'tokenTrade',
                        blockHeight
                    );

                    await TallyMap.updateChannelBalance(
                        match.channel,
                        match.buyOrder.offeredPropertyId,
                        -match.amountOfTokenB,
                        'tokenTrade',
                        blockHeight);

                }else{
                    // Debit the traded amount from the seller's reserve 
                    await TallyMap.updateBalance(
                        match.sellOrder.sender,
                        match.sellOrder.offeredPropertyId,
                        0,  // Credit traded amount of Token B to available
                        -match.amountOfTokenA, // Debit the same amount from reserve
                        0, 0,'tokenTrade',blockHeight
                    );
                    //and credit the opposite consideration to available

                    // Update balance for the buyer
                    // Debit the traded amount from the buyer's reserve and credit it to available
                    await TallyMap.updateBalance(
                        match.buyOrder.sender,
                        match.buyOrder.offeredPropertyId,
                        0,  // Credit traded amount of Token B to available
                        -match.amountOfTokenB, // Debit the same amount from reserve
                        0, 0,'tokenTrade',blockHeight );

                }

                  // Construct a trade object for recording
                const trade = {
                    offeredPropertyId: match.sellOrder.offeredPropertyId,
                    desiredPropertyId: match.buyOrder.offeredPropertyId,
                    amountOffered: match.amountOfTokenA, // or appropriate amount
                    amountExpected: match.amountOfTokenB, // or appropriate amount
                    // other relevant trade details...
                };
                if(channel==false){
                    const key = this.normalizeOrderBookKey(sellOrderPropertyId,buyOrderPropertyId)

                    console.log('checking match before volume index save ' +JSON.stringify(key,[match.amountOfTokenA,match.amountOfTokenB],match.tradePrice,blockHeight))
                    VolumeIndex.saveVolumeDataById(key,[match.amountOfTokenA,match.amountOfTokenB],match.tradePrice,blockHeight,'onChainToken')
                }else{
                    const key = this.normalizeOrderBookKey(sellOrderPropertyId,buyOrderPropertyId)

                    console.log('checking match before volume index save ' +JSON.stringify(key,[match.amountOfTokenA,match.amountOfTokenB],match.tradePrice,blockHeight))
                    VolumeIndex.saveVolumeDataById(key,[match.amountOfTokenA,match.amountOfTokenB],match.tradePrice,blockHeight,'channelToken') 
                }

                var qualifiesBasicLiqReward = await this.evaluateBasicLiquidityReward(match,channel,false)
                var qualifiesEnhancedLiqReward = await this.evaluateEnhancedLiquidityReward(match,channel)
                
                if(qualifiesBasicLiqReward){
                        const liqRewardBaseline1= await VolumeIndex.baselineLiquidityReward(match.amountOfTokenA,0.000025,match.sellOrder.offeredPropertyId)
                        const liqRewardBaseline2= await VolumeIndex.baselineLiquidityReward(match.amountOfTokenB,0.000025,match.buyOrder.desiredPropertyId)
                        TallyMap.updateBalance(sellerAddress,3,liqRewardBaseline,0,0,0,'baselineLiquidityReward')
                        TallyMap.updateBalance(buyerAddress,3,liqRewardBaseline,0,0,0,'baselineLiquidityReward')
                }

                if(qualifiesEnhancedLiqReward){
                        const liqReward1= await VolumeIndex.calculateLiquidityReward(match.amountOfTokenA,match.sellOrder.offeredPropertyId)
                        const liqReward2= await VolumeIndex.calculateLiquidityReward(match.amountOfTokenB,match.buyOrder.offeredPropertyId)
                        TallyMap.updateBalance(sellerAddress,3,liqReward1,0,0,0,'enhancedLiquidityReward')
                        TallyMap.updateBalance(buyerAddress,3,liqReward2,0,0,0,'enhancedLiquidityReward')
                }

                // Record the token trade
                await this.recordTokenTrade(trade, blockHeight, txid);

                }
        }    

        async addContractOrder(contractId, price, amount, sell, insurance, blockTime, txid, sender, isLiq, reduce, post, stop) {
            const ContractRegistry = require('./contractRegistry.js')
            const inverse = ContractRegistry.isInverse(contractId)
            const MarginMap = require('./marginMap.js')
            const marginMap = await MarginMap.loadMarginMap(contractId);
                         // Get the existing position sizes for buyer and seller
            const existingPosition = await marginMap.getPositionForAddress(sender, contractId);
            // Determine if the trade reduces the position size for buyer or seller
            const isBuyerReducingPosition = Boolean(existingPosition.contracts > 0 &&sell==false);
            const isSellerReducingPosition = Boolean(existingPosition.contracts < 0 && sell==true);
            let initialReduce = false
            //console.log('adding contract order... existingPosition? '+JSON.stringify(existingPosition)+' reducing position? '+isBuyerReducingPosition + ' '+ isSellerReducingPosition)
            let initMargin = 0
            if(isBuyerReducingPosition==false&&isSellerReducingPosition==false){
                //we're increasing or creating a new position so locking up init margin in the reserve column on TallyMap
                //console.log('about to call moveCollateralToMargin '+contractId, amount, sender)
                initMargin = await ContractRegistry.moveCollateralToReserve(sender, contractId, amount, price,blockTime) //first we line up the capital
            }else if(isBuyerReducingPosition||isSellerReducingPosition){
                initialReduce=true
            }

            // Create a contract order object with the sell parameter
            const contractOrder = { contractId, amount, price, blockTime, sell, initMargin, sender, txid, isLiq, reduce,post,stop, initialReduce};

            // The orderBookKey is based on the contractId since it's a derivative contract
            const orderBookKey = `${contractId}`;
            const orderbook = new Orderbook(contractId);
            var orderbookData = await orderbook.loadOrderBook(orderBookKey,false);
            // Load the order book for the given contract
        
            // Insert the contract order into the order book
            //console.log('checking orderbook in addcontract order '+txid+JSON.stringify(orderbookData))
            console.log('is sell? '+sell)
            orderbookData = await orderbook.insertOrder(contractOrder, orderbookData, sell,isLiq);

            //console.log('checking orderbook in addcontract order after insert '+JSON.stringify(orderbook))
            // Match orders in the derivative contract order book
            var matchResult = await orderbook.matchContractOrders(orderbookData);
            if(matchResult.matches !=[]){
                //console.log('contract match result '+JSON.stringify(matchResult))
                await orderbook.processContractMatches(matchResult.matches, blockTime, false)
            }
           
            console.log('about to save orderbook in contract trade '+orderBookKey)
                        await orderbook.saveOrderBook(matchResult.orderBook,orderBookKey);

            return matchResult
        }

        async matchContractOrders(orderBook) {
            if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
                return { orderBook: orderBook, matches: [] }; // Return empty matches if no orders
            }

            let matches = [];

            // Sort buy and sell orders by price and time
            orderBook.buy.sort((a, b) => BigNumber(b.price).comparedTo(a.price) || a.time - b.time); // Highest price first
            orderBook.sell.sort((a, b) => BigNumber(a.price).comparedTo(b.price) || a.time - b.time); // Lowest price first

            let counter =0 
            // Match orders
            while (orderBook.sell.length > 0 && orderBook.buy.length > 0) {
                let sellOrder = orderBook.sell[0];
                let buyOrder = orderBook.buy[0];
                counter+=1
                //console.log('matching loop count '+counter)
                //console.log(JSON.stringify(buyOrder))
                // Remove orders with zero amounts
                if (BigNumber(sellOrder.amount).isZero()) {
                    orderBook.sell.shift();
                    continue;
                }
                if (BigNumber(buyOrder.amount).isZero()) {
                    orderBook.buy.shift();
                    continue;
                }

                let txid= ''

                if(sellOrder.reduce==true){
                      let sellerPosition = await marginMap.getPositionForAddress(sellOrder.sender, buyOrder.contractId);
                      if(sellerPosition.contracts<=0){
                        //reduce only order is auto-cancelled
                        orderBook.sell.shift();
                      }else if(sellerPosition.contracts>sellOrder.amount){
                        sellOrder.amount=sellerPosition.contracts
                      }
                }else if(buyOrder.reduce==true){
                    let buyerPosition = await marginMap.getPositionForAddress(buyOrder.sender, buyOrder.contractId);
                    if(buyerPosition.contracts>=0){
                        //reduce only order is auto-cancelled
                        orderBook.buy.shift();
                    }else if(sellerPosition.contracts>sellOrder.amount){
                        buyOrder.amount=buyerPosition.contracts
                    }
                }

                let tradePrice
                let bumpTrade = false
                let post = false
                    if(sellOrder.blockTime == buyOrder.blockTime){
                        console.log('trades in the same block, defaulting to buy order')
                        tradePrice = buyOrder.price
                        if(sellOrder.post){
                            tradePrice = sellOrder.price
                            post = true
                            sellOrder.maker=true
                            buyOrder.maker=false
                        }else if(buyOrder.post){
                            tradePrice = buyOrder.price
                            post = true
                            buyOrder.maker=true
                            sellOrder.maker=false
                        }else{
                            sellOrder.maker=false
                            buyOrder.maker=false
                        }
                    }else{
                        tradePrice = sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
                        sellOrder.maker = Boolean(sellOrder.blockTime < buyOrder.blockTime)
                        buyOrder.maker = Boolean(buyOrder.blockTime < sellOrder.blockTime)
                        if(sellOrder.blockTime < buyOrder.blockTime&&buyOrder.post==true){
                            bumpTrade = true
                        }
                        if(buyOrder.blockTime < sellOrder.blockTime&&sellOrder.post==true){
                            bumpTrade = true
                        }
                    } 
                    if(sellOrder.blockTime == buyOrder.blockTime){
                        console.log('contract trades in the same block, defaulting to buy order')
                        tradePrice = buyOrder.price
                    }else{
                        tradePrice = sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
                    }
                    if(buyOrder.txid=="5f248411be5c28e85bee768498f16aeb90ce988e34efbb4038434fd0af235975"){
                        console.log('ding ding ')
                    }
                    if(!sellOrder.maker){
                        txid = sellOrder.txid
                    }else if(!buyOrder.maker){
                        txid = buyOrder.txid
                    }

                // Check for price match
                if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                    const ContractRegistry = require('./contractRegistry.js')
                    // Calculate the amount to be traded
                    let tradeAmount = BigNumber.min(sellOrder.amount, buyOrder.amount);
                    let perContract = await ContractRegistry.getInitialMargin(buyOrder.contractId, tradePrice);
                    let marginUsed = BigNumber(perContract).times(tradeAmount).decimalPlaces(8).toNumber()
                    //console.log('trade amount calc in contract match '+tradeAmount + ' '+sellOrder.amount + ' '+buyOrder.amount)
                    
                      //console.log('about to do anti-wash trade '+JSON.stringify(sellOrder)+JSON.stringify(buyOrder))

                        if (sellOrder.sender === buyOrder.sender) {
                            // Remove the maker order from the book
                            if (sellOrder.maker) {
                                orderBook.sell.shift();
                                //console.log('bumping sell order as a self-trade maker'+JSON.stringify(sellOrder))
                                console.log(JSON.stringify(orderBook))
                            } else if (buyOrder.maker) {
                                orderBook.buy.shift();
                                //console.log('bumping buy order as a self-trade maker'+JSON.stringify(buyOrder) )

                            }
                            continue
                        }


                    // Update orders after the match
                    sellOrder.amount = BigNumber(sellOrder.amount).minus(tradeAmount).toNumber();
                    buyOrder.amount = BigNumber(buyOrder.amount).minus(tradeAmount).toNumber();


                    if(bumpTrade==false){
                        // Add match to the list
                        matches.push({ 
                            sellOrder: { ...sellOrder, contractId: sellOrder.contractId, amount: tradeAmount.toNumber(), sellerAddress: sellOrder.sender, sellerTx: sellOrder.txid,liq:sellOrder.isLiq, maker: sellOrder.maker, marginUsed: marginUsed, initialReduce: sellOrder.initialReduce}, 
                            buyOrder: { ...buyOrder, contractId: buyOrder.contractId, amount: tradeAmount.toNumber(), buyerAddress: buyOrder.sender, buyerTx: buyOrder.txid, liq:buyOrder.isLiq, maker:buyOrder.maker, marginUsed: marginUsed, initialReduce: buyOrder.initialReduce},
                            tradePrice,
                            txid: txid
                        });

                        // Remove filled orders from the order book
                        if (sellOrder.amount === 0) {
                            orderBook.sell.shift();
                        }
                        if (buyOrder.amount === 0) {
                            orderBook.buy.shift();
                        }
                    }else if(bumpTrade==true){
                        if(buyOrder.post==true){
                            buyOrder.price=sellOrder.price-this.tickSize
                        }
                        if(sellOrder.post==true){
                            sellOrder.price=buyOrder.price+this.tickSize
                        }
                    }
                } else {
                    break; // No more matches possible
                }
            }

            return { orderBook: orderBook, matches:matches };
        }

        async evaluateBasicLiquidityReward(match, channel, contract) {
            var accepted = false

            var contractOrPropertyIds = []
            if(!contract){
                contractOrPropertyIds=[match.propertyId1, match.propertyId2];
            }else{
                contractOrPropertyIds=[match.sellOrder.contractId]
            }
            let issuerAddresses = [];
            
            if(contract){
                const ContractRegistry1 = require('./contractRegistry.js')

                    for (const id of contractOrPropertyIds) {
                        const contractData = await ContractRegistry1.getContractInfo(id); // Assuming you have a similar method for contracts
                        if (contractData && contractData.issuerAddress) {
                            issuerAddresses.push(contractData.issuerAddress);
                        }
                    }
            }else{
                const PropertyManager1 = require('./property.js')
                    for (const id of contractOrPropertyIds) {
                    const propertyData = await PropertyManager1.getPropertyData(id);
                    if (propertyData && propertyData.issuerAddress) {
                        issuerAddresses.push(propertyData.issuerAddress);
                    }
                }

            }
            
            for (const address of issuerAddresses) {
                const isWhitelisted = await ClearList.isAddressInClearlist(1, address);
                if (isWhitelisted) {
                    accepted=true
                }
            }
            
            return accepted;
        }

        async evaluateEnhancedLiquidityReward(match, channel) {
            var accepted = false
            
            let addressesToCheck = [];
            
            if (match.type === 'channel') {
                const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(match.address);
                addressesToCheck = [channel.A.address, channel.B.address];
            } else {
                addressesToCheck = [match.buyerAddress, match.sellerAddress];
            }
            
            for (const address of addressesToCheck) {
                const isWhitelisted = await ClearList.isAddressInClearlist(2, address);
                if (isWhitelisted) {
                    accepted=true;
                }
            }
            
            return accepted;
        }

        async processContractMatches(matches, currentBlockHeight, channel){
            const TallyMap = require('./tally.js');
            const ContractRegistry = require('./contractRegistry.js')
            if (!Array.isArray(matches)) {
                // Handle the non-iterable case, e.g., log an error, initialize as an empty array, etc.
                console.error('Matches is not an array:', matches);
                matches = []; // Initialize as an empty array if that's appropriate
            }
            const MarginMap = require('./marginMap.js')
            const tradeHistoryManager = new TradeHistory()

            //console.log('processing contract mathces '+JSON.stringify(matches))
            let counter = 0 
            for (const match of matches) {
                    counter+=1
                    if(match.buyOrder.buyerAddress == match.sellOrder.sellerAddress){
                        console.log('self trade nullified '+match.buyOrder.buyerAddress)
                        continue
                    }

                    let debugFlag = false
                    if(match.txid=="5f248411be5c28e85bee768498f16aeb90ce988e34efbb4038434fd0af235975"){
                        debugFlag = true
                        console.log('showing matches w/ counter '+counter+JSON.stringify(match))
                    }
                    // Load the margin map for the given series ID and block height
                    const marginMap = await MarginMap.loadMarginMap(match.sellOrder.contractId);
                    const isInverse = await ContractRegistry.isInverse(match.sellOrder.contractId)
                    match.inverse = isInverse

                    let collateralPropertyId = await ContractRegistry.getCollateralId(match.buyOrder.contractId)
                    const blob = await ContractRegistry.getNotionalValue(match.sellOrder.contractId,match.tradePrice)
                    const notionalValue = blob.notionalValue
                    const perContractNotional = blob.notionalPerContract;
                    console.log('returned notionalValue '+notionalValue+' '+perContractNotional)
                    let reserveBalanceA = await TallyMap.getTally(match.sellOrder.sellerAddress,collateralPropertyId)
                    let reserveBalanceB = await TallyMap.getTally(match.buyOrder.buyerAddress,collateralPropertyId)
                    if(debugFlag){
                        console.log('checking reserves in process contract matches '+JSON.stringify(reserveBalanceA)+' '+JSON.stringify(reserveBalanceB))
                    }
                      //console.log('checking the marginMap for contractId '+ marginMap )
                    // Get the existing position sizes for buyer and seller
                    match.buyerPosition = await marginMap.getPositionForAddress(match.buyOrder.buyerAddress, match.buyOrder.contractId);
                    match.sellerPosition = await marginMap.getPositionForAddress(match.sellOrder.sellerAddress, match.buyOrder.contractId);
                    if(match.buyerPosition.address==undefined){
                        match.buyerPosition.address=match.buyOrder.buyerAddress
                    }
                    if(match.sellerPosition.address==undefined){
                        match.sellerPosition.address=match.sellOrder.sellerAddress
                    }
                    //console.log('checking positions '+JSON.stringify(match.buyerPosition)+' '+JSON.stringify(match.sellerPosition))
                    const isBuyerReducingPosition = Boolean(match.buyerPosition.contracts < 0);
                    const isSellerReducingPosition = Boolean(match.sellerPosition.contracts > 0);
                    let buyerReReserve= false
                    let sellerReReserve = false
                    if(!isBuyerReducingPosition&&match.buyOrder.initialReduce==true){
                        await ContractRegistry.moveCollateralToReserve(match.buyOrder.buyerAddress, match.buyOrder.contractId, match.buyOrder.amount, match.tradePrice,blockTime) //first we line up the capital
                        buyerReReserve=true
                    }

                    if(!isSellerReducingPosition&&match.sellOrder.initialReduce==true){
                        await ContractRegistry.moveCollateralToReserve(match.sellOrder.sellerAddress, match.buyOrder.contractId, match.sellOrder.amount, match.tradePrice,blockTime) //first we line up the capital
                        sellerReReserve=true
                    }

                    console.log('about to calc fee '+match.buyOrder.amount+' '+match.sellOrder.maker+' '+match.buyOrder.maker+' '+isInverse+' '+match.tradePrice+' '+notionalValue+' '+channel)
                    let buyerFee = this.calculateFee(match.buyOrder.amount, match.sellOrder.maker,match.buyOrder.maker,isInverse,true, match.tradePrice,notionalValue, channel)
                    let sellerFee = this.calculateFee(match.sellOrder.amount, match.sellOrder.maker,match.buyOrder.maker,isInverse,false,match.tradePrice,notionalValue, channel)

                    await TallyMap.updateFeeCache(collateralPropertyId,buyerFee)
                    await TallyMap.updateFeeCache(collateralPropertyId,sellerFee)

                    //console.log('reducing? buyer '+isBuyerReducingPosition +' seller '+isSellerReducingPosition+ ' buyer fee '+buyerFee +' seller fee '+sellerFee)
                   
                    let feeInfo = await this.locateFee(match, reserveBalanceA, reserveBalanceB,collateralPropertyId,buyerFee, sellerFee, isBuyerReducingPosition, isSellerReducingPosition,currentBlockHeight)         
                    //now we have a block of ugly code that should be refactored into functions, reuses code for mis-matched margin in moveCollateralToMargin
                    //the purpose of which is to handle flipping positions long to short or visa versa
                    const isBuyerFlippingPosition =  Boolean((match.buyOrder.amount>Math.abs(match.buyerPosition.contracts))&&match.buyerPosition.contracts<0)
                    const isSellerFlippingPosition = Boolean((match.sellOrder.amount>Math.abs(match.sellerPosition.contracts))&&match.sellerPosition.contracts>0)
                    /*if(match.sellOrder.sellerTx=="17e7d707a2b8ff0e4b4fc0ce35e85088431122a90266b60e8355ee6e528157ff"){
                        console.log('checking our flip logic '+isBuyerFlippingPosition+ ' '+isSellerFlippingPosition)
                    }*/
                    let flipLong = 0 
                    let flipShort = 0
                    let initialMarginPerContract
                    let buyerFullyClosed =false
                    let sellerFullyClosed = false
                    
                        console.log('debug flag flags '+isBuyerFlippingPosition+isSellerFlippingPosition+isBuyerReducingPosition+isSellerReducingPosition)

                    if(isBuyerFlippingPosition){
                        flipLong=match.buyOrder.amount-Math.abs(match.buyerPosition.contracts)
                        initialMarginPerContract = await ContractRegistry.getInitialMargin(match.buyOrder.contractId, match.tradePrice);
                        
                        if(feeInfo.buyFeeFromMargin){
                            match.buyOrder.marginUsed= BigNumber(buyOrder.marginUsed).minus(buyerFee).decimalPlaces(8).toNumber()
                        }
                        console.log('checking flip logic checking hasSufficientBalance'+match.buyOrder.buyerAddress+ ' '+collateralPropertyId + ' '+totalMargin)
                        let hasSufficientBalance = await TallyMap.hasSufficientBalance(match.buyOrder.buyerAddress, collateralPropertyId,buyOrder.marginUsed)
                        if (hasSufficientBalance.hasSufficient==false) {
                            console.log('checking flip logic shortfall '+JSON.stringify(hasSufficientBalance))
                            if (initialMarginPerContract !== 0) {
                                let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                                    .dividedBy(initialMarginPerContract)
                                    .decimalPlaces(0, BigNumber.ROUND_CEIL)
                                    .toNumber();

                                flipLong -= contractUndo;
                                const flipLongBN = new BigNumber(flipLong)
                                match.buyOrder.marginUsed = BigNumber(initialMarginPerContract).times(flipLongBN).decimalPlaces(8).toNumber();
                            }
                        }

                        if(!buyerReReserve){      
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, -buyOrder.marginUsed, buyOrder.marginUsed, 0, 0, 'contractReserveInitMargin',currentBlockHeight);
                        }    
                        
                        await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, 0, -buyOrder.marginUsed, buyOrder.marginUsed, 0, 'contractTradeInitMargin',currentBlockHeight);
                        await marginMap.setInitialMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId, buyOrder.marginUsed);
                        await marginMap.recordMarginMapDelta(match.buyOrder.buyerAddress, contractId, match.buyerPosition.contracts+amount, amount,0,0,0,'updateContractBalancesFlip')
                        buyerFullyClosed=true
                        console.log('checking flip logic '+flipLong+' '+match.buyOrder.amount + ' '+Math.abs(match.buyerPosition.contracts))
                    }
                    
                    if(isSellerFlippingPosition){
                        flipShort=match.sellOrder.amount-Math.abs(match.sellerPosition.contracts)
                        initialMarginPerContract = await ContractRegistry.getInitialMargin(match.sellOrder.contractId, match.tradePrice);
                        match.sellOrder.marginUsed = BigNumber(initialMarginPerContract).times(flipLong).decimalPlaces(8).toNumber()
                        console.log('checking sell flip logic checking hasSufficientBalance'+match.sellOrder.sellerAddress+ ' '+collateralPropertyId + ' '+match.sellOrder.marginUsed)
                        if(feeInfo.sellFeeFromMargin){
                            const sellerFeeBN = new BigNumber(sellerFee)
                            match.sellOrder.marginUsed= BigNumber(match.sellOrder.marginUsed).minus(sellerFeeBN).decimalPlaces(8).toNumber()
                        }
                        
                        let hasSufficientBalance = await TallyMap.hasSufficientBalance(match.sellOrder.sellerAddress, collateralPropertyId,match.sellOrder.marginUsed)
                        
                        if (hasSufficientBalance.hasSufficient==false) {
                            console.log('checking flip logic shortfall '+JSON.stringify(hasSufficientBalance))
                      
                            let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                                .dividedBy(initialMarginPerContract)
                                .decimalPlaces(0, BigNumber.ROUND_CEIL)
                                .toNumber();

                            flipShort -= contractUndo;
                            const flipShortBN = new BigNumber(flipShort)
                            match.sellOrder.marginUsed = BigNumber(initialMarginPerContract).times(flipShortBN).decimalPlaces(8).toNumber();
                        }

                        if(!sellerReReserve){
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, -match.sellOrder.marginUsed, match.sellOrder.marginUsed, 0, 0, 'contractReserveInitMargin',currentBlockHeight);
                        }

                        await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, 0, -match.sellOrder.marginUsed, match.sellOrder.marginUsed, 0, 'contractTradeInitMargin',currentBlockHeight);
                        await marginMap.setInitialMargin(match.sellOrder.sellerAddress, match.sellOrder.contractId, match.sellOrder.marginUsed);
                        await marginMap.recordMarginMapDelta(match.sellOrder.sellerAddress, match.sellOrder.contractId, match.sellerPosition.contracts-match.sellOrder.amount, match.sellOrder.amount,0,0,0,'updateContractBalancesFlip')
                        sellerFullyClosed=true
                        console.log('checking flip logic' +flipShort)
                    }

                    console.log('about to go into logic brackets for init margin '+isBuyerReducingPosition + ' seller reduce? '+ isSellerReducingPosition+ ' channel? '+channel)
                
                    console.log('looking at feeInfo obj '+JSON.stringify(feeInfo))
                    if(!isBuyerReducingPosition){
                        if(channel==false){
                            // Use the instance method to set the initial margin
                            console.log('moving margin buyer not channel not reducing '+counter+' '+match.buyOrder.buyerAddress+' '+match.buyOrder.contractId+' '+match.buyOrder.amount+' '+match.buyOrder.marginUsed)
                            match.buyerPosition = await ContractRegistry.moveCollateralToMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId,match.buyOrder.amount, match.tradePrice, match.buyOrder.price,false,match.buyOrder.marginUsed,channel,null,currentBlockHeight,feeInfo,match.buyOrder.maker,debugFlag)
                            console.log('looking at feeInfo obj '+JSON.stringify(feeInfo))
                        }else if(channel==true){
                            console.log('moving margin buyer channel not reducing '+counter+' '+match.buyOrder.buyerAddress+' '+match.buyOrder.contractId+' '+match.buyOrder.amount+' '+match.buyOrder.marginUsed)
                            match.buyerPosition = await ContractRegistry.moveCollateralToMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId,match.buyOrder.amount, match.buyOrder.price, match.buyOrder.price,false,match.buyOrder.marginUsed,channel, match.channelAddress,currentBlockHeight,feeInfo,match.buyOrder.maker, debugFlag)                  
                        }
                        //console.log('buyer position after moveCollat '+match.buyerPosition)
                    }
                    // Update MarginMap for the contract series
                    if(!isSellerReducingPosition){
                        if(channel==false){
                            // Use the instance method to set the initial margin
                            console.log('moving margin seller not channel not reducing '+counter+' '+match.sellOrder.sellerAddress+' '+match.sellOrder.contractId+' '+match.sellOrder.amount+' '+match.sellOrder.initMargin)
                            match.sellerPosition = await ContractRegistry.moveCollateralToMargin(match.sellOrder.sellerAddress, match.sellOrder.contractId,match.sellOrder.amount, match.tradePrice,match.sellOrder.price, true, match.sellOrder.marginUsed,channel,null,currentBlockHeight,feeInfo,match.buyOrder.maker)
                         }else if(channel==true){
                            console.log('moving margin seller channel not reducing '+counter+' '+match.sellOrder.sellerAddress+' '+match.sellOrder.contractId+' '+match.sellOrder.amount+' '+match.sellOrder.initMargin)
                            match.sellerPosition = await ContractRegistry.moveCollateralToMargin(match.sellOrder.sellerAddress, match.sellOrder.contractId,match.sellOrder.amount, match.sellOrder.price,match.sellOrder.price, true, match.sellOrder.marginUsed,channel, match.channelAddress,currentBlockHeight,feeInfo,match.buyOrder.maker)
                         }
                        console.log('sellerPosition after moveCollat '+match.sellerPosition)
                    }


                    //console.log('checking position for trade processing '+JSON.stringify(match.buyerPosition) +' buyer size '+' seller size '+JSON.stringify(match.sellerPosition))
                    //console.log('reviewing Match object before processing '+JSON.stringify(match))
                    // Update contract balances for the buyer and seller
                    let close = false
                    let flip = false
                    if((isBuyerReducingPosition||isSellerReducingPosition)&&(isBuyerFlippingPosition==false||isSellerFlippingPosition==false)){
                        close = true
                    }else if(isBuyerFlippingPosition==true||isSellerFlippingPosition==true){
                        flip=true
                    }
                    if(channel==true){
                        console.log('checking match obj before calling update contract balances '+JSON.stringify(match))
                    }
                    console.log('close? flip? '+close+' '+flip)
                    let positions = await marginMap.updateContractBalancesWithMatch(match, channel, close,flip)
                    let sellerClosed = 0
                    let buyerClosed = 0
                    
                    if(isBuyerReducingPosition||isBuyerFlippingPosition){
                        buyerClosed =match.buyOrder.amount-flipLong
                    }
                    
                    if(isSellerReducingPosition||isSellerFlippingPosition){
                        sellerClosed = match.sellOrder.amount-flipShort
                    }

                    if(match.buyerPosition.contracts==match.buyOrder.amount&&isBuyerReducingPosition){
                        buyerFullyClosed=true
                    }

                    if(match.sellerPosition.contracts==match.sellOrder.amount&&isSellerReducingPosition){
                        sellerFullyClosed=true
                    }

                    const trade = {
                        contractId: match.sellOrder.contractId,
                        amount: match.sellOrder.amount,
                        price: match.tradePrice,
                        buyerAddress: match.buyOrder.buyerAddress,
                        sellerAddress: match.sellOrder.sellerAddress,
                        sellerTx: match.sellOrder.sellerTx,
                        buyerTx: match.buyOrder.buyerTx,
                        buyerClose: buyerClosed,
                        sellerClose: sellerClosed,
                        block: currentBlockHeight,
                        buyerFullClose: buyerFullyClosed,
                        sellerFullClose: sellerFullyClosed,
                        flipLong: flipLong,
                        flipShort: flipShort,
                        channel: channel
                        // other relevant trade details...
                    };

                    match.buyerPosition = positions.bp
                    match.sellerPosition = positions.sp
                    //console.log('checking positions based on mMap vs. return of object in contract update '+JSON.stringify(positions)+' '+JSON.stringify(match.buyerPosition) + ' '+JSON.stringify(match.sellerPosition))

                    //console.log('checking positions after contract adjustment, seller '+JSON.stringify(match.sellerPosition) + ' buyer '+JSON.stringify(match.buyerPosition))

                    // Record the contract trade
                    await this.recordContractTrade(trade, currentBlockHeight);
                    // Determine if the trade reduces the position size for buyer or seller
                    let lastMark = await ContractRegistry.getPriceAtBlock(trade.contractId, currentBlockHeight)
                    if(lastMark==null){lastMark=trade.price}
                    // Realize PnL if the trade reduces the position size
                    let buyerPnl = 0, sellerPnl = 0;
                    if (isBuyerReducingPosition||isBuyerFlippingPosition) {
                        let closedContracts = match.buyOrder.amount

                        if(isBuyerFlippingPosition){
                            closedContracts-=flipLong
                        }
                        //this loops through our position history and closed/open trades in that history to figure a precise entry price for the trades 
                        //on a LIFO basis that are being retroactively 'closed' by reference here
                        //console.log('about to call trade history manager '+match.buyOrder.contractId)
                        //const LIFO = tradeHistoryManager.calculateLIFOEntry(match.buyOrder.buyerAddress, closedContracts, match.buyOrder.contractId)
                        //{AvgEntry,blockTimes}
                        let avgEntry = match.buyerPosition.avgPrice 
                        //then we take that avg. entry price, not for the whole position but for the chunk that is being closed
                        //and we figure what is the PNL that one would show on their taxes, to save a record.
                        const accountingPNL = await marginMap.realizePnl(match.buyOrder.buyerAddress, closedContracts, match.tradePrice, avgEntry, isInverse, perContractNotional, match.buyerPosition, true,match.buyOrder.contractId);
                        //then we will look at the last settlement mark price for this contract or default to the LIFO Avg. Entry if
                        //the closing trade and the opening trades reference happened in the same block (exceptional, will add later)
                        console.log('about to call settlePNL '+closedContracts+' '+match.tradePrice+' '+lastMark)
                        const settlementPNL = await marginMap.settlePNL(match.buyOrder.buyerAddress, closedContracts, match.tradePrice, lastMark, match.buyOrder.contractId, currentBlockHeight) 
                        //then we figure out the aggregate position's margin situation and liberate margin on a pro-rata basis 
                        console.log('position before going into reduce Margin '+accountingPNL+' '+settlementPNL+' '+JSON.stringify(match.buyerPosition))
                        const reduction = await marginMap.reduceMargin(match.buyerPosition, closedContracts, accountingPNL /*settlementPNL*/, isInverse,match.buyOrder.contractId, match.buyOrder.buyerAddress, true,feeInfo.buyFeeFromMargin,buyerFee);
                        //{netMargin,mode}   
                        if(reduction !=0&&channel==false){
                            //console.log('reduction about to pass to TallyMap' +reduction)
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, reduction, 0, -reduction, 0, 'contractTradeMarginReturn',currentBlockHeight)              
                        }
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
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, /*accountingPNL*/settlementPNL, 0, 0/*-settlementPNL*/, 0, 'contractTradeSettlement',currentBlockHeight);
                        } 
                        if(reduction.mode=='shortfall'){
                            //check the address available balance for the neg. balance
                            //if there's enough in available then do a tallyMap shuffle
                            //otherwise go to insurance or maybe post a system loss at the bankruptcy price and see if it can get cleared before tapping the ins. fund
                        }

                        
                        const savePNLParams = {height:currentBlockHeight, contractId:match.buyOrder.contractId, accountingPNL: accountingPNL, 
                            address: match.buyOrder.buyerAddress, amount: closedContracts, tradePrice: match.tradePrice, collateralPropertyId: collateralPropertyId,
                            timestamp: new Date().toISOString(), txid: match.buyOrder.buyerTx, settlementPNL: settlementPNL, marginReduction:reduction, avgEntry: avgEntry}
                        //console.log('preparing to call savePNL with params '+JSON.stringify(savePNLParams))
                        tradeHistoryManager.savePNL(savePNLParams)
                    }

                    if (isSellerReducingPosition||isSellerFlippingPosition){
                        let closedContracts = match.sellOrder.amount

                        if(isSellerFlippingPosition){
                            closedContracts-=flipShort
                        }
                        //this loops through our position history and closed/open trades in that history to figure a precise entry price for the trades 
                        //on a LIFO basis that are being retroactively 'closed' by reference here
                        //console.log('position before going into LIFO '+JSON.stringify(match.sellerPosition))
                        //console.log('about to call trade history manager '+match.sellOrder.contractId)
                        //const LIFO = await tradeHistoryManager.calculateLIFOEntry(match.sellOrder.sellerAddress, closedContracts, match.sellOrder.contractId)
                        let avgEntry = match.sellerPosition.avgPrice
                        //{AvgEntry,blockTimes} 
                        //then we take that avg. entry price, not for the whole position but for the chunk that is being closed
                        //and we figure what is the PNL that one would show on their taxes, to save a record.
                        //console.log('LIFO '+JSON.stringify(LIFO))

                        console.log('position before realizePnl '+JSON.stringify(match.sellerPosition))
                        const accountingPNL = await marginMap.realizePnl(match.sellOrder.sellerAddress, closedContracts, match.tradePrice, avgEntry, isInverse, notionalValue, match.sellerPosition, false,match.sellOrder.contractId);
                       //then we will look at the last settlement mark price for this contract or default to the LIFO Avg. Entry if
                        //the closing trade and the opening trades reference happened in the same block (exceptional, will add later)
                        
                        console.log('position before settlePNL '+JSON.stringify(match.sellerPosition))
                        const settlementPNL = await marginMap.settlePNL(match.sellOrder.sellerAddress, closedContracts, match.tradePrice, lastMark, match.sellOrder.contractId,currentBlockHeight) 
                        //then we figure out the aggregate position's margin situation and liberate margin on a pro-rata basis 
                        console.log('position before going into reduce Margin '+closedContracts+' '+flipShort+' '+match.sellOrder.amount/*JSON.stringify(match.sellerPosition)*/)
                        const reduction = await marginMap.reduceMargin(match.sellerPosition, closedContracts, accountingPNL/*settlementPNL*/, isInverse, match.sellOrder.contractId, match.sellOrder.sellerAddress, false,feeInfo.sellFeeFromMargin,sellerFee);
                        //{netMargin,mode} 
                        if(reduction !=0){
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, reduction, 0, -reduction, 0, 'contractTradeMarginReturn',currentBlockHeight)              
                        } //then we move the settlementPNL out of margin assuming that the PNL is not exactly equal to maintainence margin
                        //the other modes (for auditing/testing) would be, PNL is positive and you get back init. margin 'profit'
                        //PNL is positive and you get back some fraction of the init. margin that was previously settled out 'fractionalProfit'
                        //PNL is negative and you get back more than maint. margin but of course less than init. margin 'moreThanMaint'
                        //PNL is negative and you get back <= maintainence margin which hasn't yet cleared/topped-up 'lessThanMaint'
                        //PNL is negative and all the negative PNL has exactly matched the maintainence margin which won't need to be topped up,
                        //unusual edge case but we're covering it here 'maint'
                        if(reduction.mode!='maint'){
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, /*accountingPNL*/settlementPNL, 0, 0, 0, 'contractTradeSettlement',currentBlockHeight);
                        } 
                       const savePNLParams = {height:currentBlockHeight, contractId:match.sellOrder.contractId, accountingPNL: accountingPNL, 
                            address: match.sellOrder.sellerAddress, amount: closedContracts, tradePrice: match.tradePrice, collateralPropertyId: collateralPropertyId,
                            timestamp: new Date().toISOString(), txid: match.sellOrder.sellerTx, settlementPNL: settlementPNL, marginReduction:reduction, avgEntry: avgEntry}
                        //console.log('preparing to call savePNL with params '+JSON.stringify(savePNLParams))
                        tradeHistoryManager.savePNL(savePNLParams)
                    }
                    console.log('about to call UTXOEquivalentVolume '+perContractNotional)
                    const UTXOEquivalentVolume = await VolumeIndex.getUTXOEquivalentVolume(match.sellOrder.contractId,match.sellOrder.amount, 'contract', collateralPropertyId, perContractNotional,isInverse,match.tradePrice)
                    console.log('ltc volume '+UTXOEquivalentVolume)
                    if(channel==false){
                       await VolumeIndex.saveVolumeDataById(match.sellOrder.contractId,match.sellOrder.amount,UTXOEquivalentVolume,match.tradePrice,currentBlockHeight,'onChainContract')
                    }else{
                       await VolumeIndex.saveVolumeDataById(match.sellOrder.contractId,match.sellOrder.amount,UTXOEquivalentVolume,match.tradePrice,currentBlockHeight,'channelContract')
                    }

                     //see if the trade qualifies for increased Liquidity Reward
                    var qualifiesBasicLiqReward = await this.evaluateBasicLiquidityReward(match,channel,true)
                    var qualifiesEnhancedLiqReward = await this.evaluateEnhancedLiquidityReward(match,channel)
                    if(qualifiesBasicLiqReward){
                        var notionalTokens = notionalValue*trade.amount
                        const liqRewardBaseline= await VolumeIndex.baselineLiquidityReward(notionalTokens,0.000025,collateralPropertyId)
                        TallyMap.updateBalance(match.sellOrder.sellerAddress,3,liqRewardBaseline,0,0,0,'baselineLiquidityReward')
                        TallyMap.updateBalance(match.buyOrder.buyerAddress,3,liqRewardBaseline,0,0,0,'baselineLiquidityReward')
                    }

                    if(qualifiesEnhancedLiqReward){
                        var notionalTokens = notionalValue*trade.amount
                        const liqRewardBaseline= await VolumeIndex.calculateLiquidityReward(notionalTokens)
                        TallyMap.updateBalance(match.sellOrder.sellerAddress,3,liqRewardBaseline,0,0,0,'enhancedLiquidityReward')
                        TallyMap.updateBalance(match.buyOrder.buyerAddress,3,liqRewardBaseline,0,0,0,'enhancedLiquidityReward')
                    }
                    // Save the updated margin map
                    await marginMap.saveMarginMap(false);  
            }
        }

        calculateFee(amount, sellMaker,buyMaker,isInverse,isBuyer,lastMark, notionalValue, channel){
                let fee = 0
                let BNnotionalValue=new BigNumber(notionalValue)
                let BNlastMark = new BigNumber(lastMark)
                let BNamount = new BigNumber(amount)

                console.log('inside calc fee ' +lastMark+' '+notionalValue)
              if((sellMaker==false&&buyMaker==false)||channel==true){
                        if(isInverse) {
                            fee = new BigNumber(0.000025)
                                .times(BNnotionalValue)
                                .dividedBy(BNlastMark)
                                .times(BNamount)
                                .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
                        } else {
                            fee = new BigNumber(lastMark)
                                .dividedBy(BNnotionalValue)
                                .times(0.000025)
                                .times(BNamount)
                                .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
                        }
                        return fee    
                }else if(sellMaker==true&&buyMaker==false){
                    if(isInverse) {
                            fee = new BigNumber(0.00005)
                                .times(BNnotionalValue)
                                .dividedBy(BNlastMark)
                                .times(BNamount)
                                .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
                            if(isBuyer==true){
                                return fee
                            }
                        } else {
                            fee = new BigNumber(lastMark)
                                .dividedBy(BNnotionalValue)
                                .times(0.00005)
                                .times(BNamount)
                                .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
                        }  
                        if(isBuyer==true){
                                return fee
                        }else{
                            return 0
                        } 
                }else if(sellMaker==false&&buyMaker==true){
                    if(isInverse) {
                            fee = new BigNumber(0.00005)
                                .times(BNnotionalValue)
                                .dividedBy(BNlastMark)
                                .times(BNamount)
                                .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
                    } else {
                            fee = new BigNumber(lastMark)
                                .dividedBy(BNnotionalValue)
                                .times(0.00005)
                                .times(BNamount)
                                .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
                    }    
                    if(isBuyer==false){
                                return fee
                        }else{
                            return 0
                    } 
                }
        }

        async locateFee(match, reserveBalanceA, reserveBalanceB,collateralPropertyId,buyerFee, sellerFee,isBuyerReducingPosition,isSellerReducingPosition,block){
                    const TallyMap = require('./tally.js');
                    const MarginMap = require('./marginMap.js')
                    const marginMap = await MarginMap.loadMarginMap(match.sellOrder.contractId);
                    let buyFeeFromMargin = false
                    let buyFeeFromReserve = false
                    let buyFeeFromAvailable = false
                    let sellFeeFromMargin = false
                    let sellFeeFromReserve = false
                    let sellFeeFromAvailable = false

                    let feeInfo =  {sellFeeFromAvailable: sellFeeFromAvailable, sellFeeFromReserve: sellFeeFromReserve, sellFeeFromMargin: sellFeeFromMargin, 
                        buyFeeFromAvailable: buyFeeFromAvailable, buyFeeFromReserve: buyFeeFromReserve, buyFeeFromMargin: buyFeeFromMargin, sellerFee: sellerFee, buyerFee: buyerFee}
                    console.log('locating fee')
                    let buyerAvail = TallyMap.hasSufficientBalance(match.buyOrder.buyerAddress,collateralPropertyId, buyerFee)
                    let sellerAvail = TallyMap.hasSufficientBalance(match.sellOrder.sellerAddress,collateralPropertyId, sellerFee)
                    buyerAvail = buyerAvail.hasSufficient
                    sellerAvail = sellerAvail.hasSufficient
                    if(buyerAvail){
                                
                        await TallyMap.updateBalance(match.buyOrder.buyerAddress,collateralPropertyId,-buyerFee,0,0,0,'contractFee',block)
                                feeInfo.buyFeeFromAvailable= true
                                return feeInfo
                    }
                    if(sellerAvail){
                         await TallyMap.updateBalance(match.sellOrder.sellerAddress,collateralPropertyId,-sellerFee,0,0,0,'contractFee',block)
                            feeInfo.sellFeeFromAvailable=true
                            return feeInfo
                    }
            if(isBuyerReducingPosition){
                        if(reserveBalanceB.margin<buyerFee||reserveBalanceB.margin==undefined){
                                await TallyMap.updateBalance(match.buyOrder.buyerAddress,collateralPropertyId,0,-buyerFee,0,0,'contractFee',block)                   
                                feeInfo.buyFeeFromReserve=true
                        }else{
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress,collateralPropertyId,0,0,-buyerFee,0,'contractFee',block)
                            feeInfo.buyFeeFromMargin=true
                        }        
                    }else{
                        if(reserveBalanceB.margin<buyerFee||reserveBalanceB.margin==undefined){
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress,collateralPropertyId,0,-buyerFee,0,0,'contractFee',block)
                            feeInfo.buyFeeFromReserve=true
                        }else{
                            if(reserveBalanceB.reserve<buyerFee){
                                await TallyMap.updateBalance(match.buyOrder.buyerAddress,collateralPropertyId,0,0,-buyerFee,0,'contractFee',block)
                                feeInfo.buyFeeFromMargin=true
                                await marginMap.feeMarginReduce(match.buyOrder.buyerAddress,match.buyerPosition,buyerFee,match.buyerOrder.contractId)
                            } 
                        }

                    }
                    if(isSellerReducingPosition){
                        if(reserveBalanceA.margin<buyerFee||reserveBalanceA.margin==undefined){
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress,collateralPropertyId,0,-sellerFee,0,0,'contractFee')
                            feeInfo.sellFeeFromReserve=true
                        }else{   
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress,collateralPropertyId,0,0,-sellerFee,0,'contractFee')
                            feeInfo.sellFeeFromMargin=true
                            await marginMap.feeMarginReduce(match.sellOrder.sellerAddress,match.sellerPosition,sellerFee,match.sellOrder.contractId)               
                        }
                    }else{
                        console.log('inside fee deduction '+match.sellOrder.sellerAddress)
                        if(reserveBalanceA.margin<sellerFee||reserveBalanceA.margin==undefined){
                            if(reserveBalanceA.reserve<sellerFee||reserveBalanceA.reserve==undefined){
                                await TallyMap.updateBalance(match.sellOrder.sellerAddress,collateralPropertyId,0,-sellerFee,0,0,'contractFee')
                                feeInfo.sellFeeFromReserve=true
                            }else{
                                await TallyMap.updateBalance(match.sellOrder.sellerAddress,collateralPropertyId,-sellerFee,0,0,0,'contractFee')
                                feeInfo.sellFeeFromAvailable=true
                            }
                        }
                    }
                    return feeInfo
        }

        async cancelOrdersByCriteria(fromAddress, orderBookKey, criteria, token, amm) {
            
            let orderBook = await this.loadOrderBook(orderBookKey); // Assuming this is the correct reference 
            const cancelledOrders = [];
            let returnFromReserve = 0
            console.log('orderbook object in cancel ' +JSON.stringify(orderBook))
            if(!token){
                //console.log('showing orderbook before cancel '+JSON.stringify(orderBook))
            }
            if(orderBook==undefined){
               // console.log('orderbook undefined, maybe empty ')
                return []
            }

             // Check if the cancellation criteria are for AMM orders
            if (amm) {
                    for (let i = orderBook.buy.length - 1; i >= 0; i--) {
                        const order = orderBook.buy[i];
                        // Check if the order is an AMM order (marked by "amm" sender)
                        if (order.sender === "amm") {
                            cancelledOrders.push(order);
                            orderBook.buy.splice(i, 1);
                            // Adjust return from reserve based on the cancelled order
                            if (token === true) {
                                returnFromReserve += order.amountOffered;
                            } else {
                                returnFromReserve += order.initMargin;
                            }
                        }
                    }

                    // Loop through the sell side book as well
                    for (let i = orderBook.sell.length - 1; i >= 0; i--) {
                        const order = orderBook.sell[i];
                        // Check if the order is an AMM order (marked by "amm" sender)
                        if (order.sender === "amm") {
                            cancelledOrders.push(order);
                            orderBook.sell.splice(i, 1);
                            // Adjust return from reserve based on the cancelled order
                            if (token === true) {
                                returnFromReserve += order.amountOffered;
                            } else {
                                returnFromReserve += order.initMargin;
                            }
                        }
                    }
                } else {

                    if(criteria.txid!=undefined){
                        //console.log('cancelling by txid '+criteria.txid)
                       if(criteria.buy==true){
                          for (let i = orderBook.buy.length - 1; i >= 0; i--) {
                            const ord = orderBook.buy[i]
                                if(ord.txid === criteria.txid){
                                    cancelledOrders.push(ord);

                                    //console.log('splicing order '+JSON.stringify(ord))
                                    orderBook.buy.splice(i, 1);
                                }
                           }
                        } 

                        if(criteria.buy==false){
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
                            console.log('orderbook prior to cancelling '+JSON.stringify(orderBook))
                        for (let i = orderBook.buy.length - 1; i >= 0; i--) {

                            const order = orderBook.buy[i];
                            
                            if(this.shouldCancelOrder(order,criteria)){
                                 // Logic to cancel the order
                                    cancelledOrders.push(order);

                                    //console.log('splicing order '+JSON.stringify(order))
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
                                    //console.log('splicing order '+JSON.stringify(order))
                                    orderBook.sell.splice(i, 1);

                                    if(token==true){
                                        returnFromReserve+=order.amountOffered
                                    }else{
                                        returnFromReserve+=order.initMargin
                                    }
                            }
                        }
                    }
                }
            }
              
                console.log('returning tokens from reserve '+returnFromReserve)
                cancelledOrders.returnFromReserve=returnFromReserve
                // Save the updated order book to the database

                this.orderBooks[orderBookKey] = orderBook
                console.log('orderbook after cancel operation '+orderBookKey+' '+JSON.stringify(orderBook))
                await this.saveOrderBook(orderBook, orderBookKey);

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
            //console.log('should cancel order? '+JSON.stringify(order)+' '+JSON.stringify(criteria))
            //console.log('cancel all criteria '+JSON.stringify(criteria.address!=undefined)+' '+JSON.stringify(order.sender===criteria.address))
            if(criteria.price!=undefined&&(criteria.buy ? order.price <= criteria.price : order.price >= criteria.price)){
                return true
            }
            if (criteria.address!=undefined && order.sender === criteria.address) {
                return true;
            }

            return false;
        }

        async cancelAllContractOrders(fromAddress, offeredPropertyId,block) {
            const TallyMap = require('./tally.js')
            const ContractRegistry = require('./contractRegistry.js')
            // Logic to cancel all contract orders
            // Retrieve relevant order details and calculate margin reserved amounts
            const criteria = { address: fromAddress }; // Criteria to cancel all orders for a specific address
            const key = offeredPropertyId
            //console.log('about to call cancelOrdersByCriteria in cancelAllContractOrders '+fromAddress, key, criteria)
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);
            const collateralPropertyId = await ContractRegistry.getCollateralId(offeredPropertyId);
            //console.log('returning from reserve '+cancelledOrders.returnFromReserve)
            for (const order of cancelledOrders) {
                //console.log('applying reserve changes for cancelled order '+JSON.stringify(order))
                const reserveAmount = parseFloat(order.initMargin)
                //console.log('about to apply changes '+reserveAmount+typeof reserveAmount)
                await TallyMap.updateBalance(fromAddress, collateralPropertyId, +reserveAmount, -reserveAmount,0,0,'contractCancel',block);
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelContractOrderByTxid (fromAddress, offeredPropertyId, txid,block) {
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
            await TallyMap.updateBalance(fromAddress, collateralPropertyId, reserveAmount, -reserveAmount,0,0,'contractCancel',block);

            // Return the details of the cancelled order
            return cancelledOrder;
        }

        async cancelContractBuyOrdersByPrice(fromAddress, offeredPropertyId, price, buy,block) {
            const TallyMap = require('./tally.js')
            const criteria = { price: price, buy: false }; // Criteria to cancel sell orders by price
            const key = offeredPropertyId
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);

            const collateralPropertyId = await ContractRegistry.getCollateralId(offeredPropertyId);

            for (const order of cancelledOrders) {
                const reserveAmount = order.initMargin 
                await TallyMap.updateBalance(fromAddress, collateralPropertyId, reserveAmount, -reserveAmount,0,0,'contractCancel',block);
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelAllTokenOrders(fromAddress, offeredPropertyId, desiredPropertyId,block) {
            const TallyMap = require('./tally.js')
            // Logic to cancel all token orders
            // Retrieve relevant order details and calculate margin reserved amounts
            
            const key =  this.normalizeOrderBookKey(offeredPropertyId,desiredPropertyId)
            console.log('cancelAllTokenOrders key'+key)
            let buy = false
            if(offeredPropertyId>desiredPropertyId){
                buy=true
            }
            const criteria = { address: fromAddress, buy: buy }; // Criteria to cancel all orders for a specific address
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);

            for (const order of cancelledOrders) {
                const reserveAmount = order.amountOffered;
                console.log('cancelling orders in cancelAll token orders '+JSON.stringify(order)+' '+reserveAmount)
                await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel',block);
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelTokenOrderByTxid(fromAddress, offeredPropertyId, desiredPropertyId, txid,block) {
            const TallyMap = require('./tally.js')
            // Logic to cancel a specific token order by txid
            // Retrieve order details and calculate margin reserved amount
            const key =  this.normalizeOrderBookKey(offeredPropertyId,desiredPropertyId)
            let buy = false
            if(offeredPropertyId>desiredPropertyId){
                buy=true
            }
            const cancelledOrder = await this.cancelOrdersByCriteria(fromAddress, key, {txid:txid});
            const reserveAmount = order.amountOffered;
            await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel',block);

            // Return the details of the cancelled order
            return cancelledOrder;
        }

        async cancelTokenBuyOrdersByPrice(fromAddress, offeredPropertyId, desiredPropertyId, price,block) {
            const TallyMap = require('./tally.js')
            // Logic to cancel token buy orders by price
            // Retrieve relevant buy orders and calculate margin reserved amounts
            const key =  this.normalizeOrderBookKey(offeredPropertyId,desiredPropertyId)
            let buy = false
            if(offeredPropertyId>desiredPropertyId){
                buy=true
            }
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, {price:price, buy:true});

            for (const order of cancelledOrders) {
                const reserveAmount = order.amountOffered;
                await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel',block);
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }

        async cancelTokenSellOrdersByPrice(fromAddress, offeredPropertyId, desiredPropertyId, price,block) {
            const TallyMap = require('./tally.js')
            // Logic to cancel token sell orders by price
            // Retrieve relevant sell orders and calculate margin reserved amounts
            const key =  this.normalizeOrderBookKey(offeredPropertyId,desiredPropertyId)
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, {price:price, buy:false});
            let buy = false
            if(offeredPropertyId>desiredPropertyId){
                buy=true
            }
            for (const order of cancelledOrders) {
                const reserveAmount = order.amountOffered;
                await TallyMap.updateBalance(fromAddress, offeredPropertyId, reserveAmount, -reserveAmount,0,0,'tokenCancel',block);
            }

            // Return the details of the cancelled orders
            return cancelledOrders;
        }
           
        async getOrdersForAddress(address, contractId, offeredPropertyId, desiredPropertyId) {
            const orderbookId = contractId ? contractId.toString() : `${offeredPropertyId}-${desiredPropertyId}`;

            try {
                // Load or create order book data
                const orderbookData = await this.loadOrderBook(orderbookId);
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
