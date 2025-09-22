const BigNumber = require('bignumber.js')
const dbInstance = require('./db.js'); // Import your database instance
const { v4: uuidv4 } = require('uuid');  // Import the v4 function from the uuid library
const TradeHistory = require('./tradeHistoryManager.js')
const ContractRegistry = require('./contractRegistry.js')
const VolumeIndex= require('./volumeIndex.js')
const Channels = require('./channels.js')
const ClearList = require('./clearlist.js')
const Consensus = require('./consensus.js')

class Orderbook {
      constructor(orderBookKey, tickSize = new BigNumber('0.00000001')) {
            this.tickSize = tickSize;
            this.orderBookKey = orderBookKey; // Unique identifier for each orderbook (contractId or propertyId pair)
            this.orderBooks = {};
            this.block = 1
            //this.loadOrderBook(); // Load or create an order book based on the orderBookKey
        }
         // Static async method to get an instance of Orderbook
        static async getOrderbookInstance(orderBookKey) {
            const orderbook = new Orderbook(orderBookKey); // Create instance
            orderbook.orderBooks[orderBookKey] = await orderbook.loadOrderBook(orderBookKey); // Load orderbook
            console.log("Returning Orderbook instance:", orderbook);
            console.log("Does it have estimateLiquidation?", typeof orderbook.estimateLiquidation);
            return orderbook;
        }

        async loadOrderBook(key,addr) {
                const stringKey = typeof key === 'string' ? key : String(key);
                const orderBooksDB = await dbInstance.getDatabase('orderBooks');

                try {
                    const orderBookData = await orderBooksDB.findOneAsync({ _id: stringKey });
                    console.log('load book '+JSON.stringify(orderBookData))
                    if (orderBookData && orderBookData.value) {
                        const parsedOrderBook = JSON.parse(orderBookData.value);
                        this.orderBooks[key] = parsedOrderBook;
                        //console.log('loading the orderbook in check from addr '+addr+' for ' + key + ' in the form of ' + JSON.stringify(parsedOrderBook.buy));
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
            await orderBooksDB.loadDatabase();
            return
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

         /**
         * Get the total reserved margin for a specific address across buy and sell orders
         * @param {string} address - The address whose reserved margin is being calculated
         * @returns {BigNumber} - Total reserved margin for the address
         */
        getReserveByAddress(address,key) {
            const stringKey = typeof key === 'string' ? key : String(key);

            let totalReserved = new BigNumber(0);
            for (const side of ["buy", "sell"]) {
                console.log('inside get reserve by addr book '+JSON.stringify(this.orderBooks))
                if (!this.orderBooks[stringKey][side]) continue;
                for (const order of this.orderBooks[stringKey][side]) {
                    if ((order.sender || order.address) === address) {
                        console.log('in getReserveByAddr '+totalReserved.toNumber())
                        totalReserved = totalReserved.plus(order.initMargin || 0);
                    }
                }
            }
            return totalReserved;
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
        if (!orderbookData || typeof orderbookData !== 'object') {
            console.error("⚠️ Invalid orderbookData received:", orderbookData);
            return { orderBook: { buy: [], sell: [] }, matches: [] };
        }

        let orderBookCopy = {
            buy: Array.isArray(orderbookData.buy) ? [...orderbookData.buy] : [],
            sell: Array.isArray(orderbookData.sell) ? [...orderbookData.sell] : []
        };

        console.log(`📊 Matching orders... Buy: ${orderBookCopy.buy.length}, Sell: ${orderBookCopy.sell.length}`);

        let matches = [];

        // Sort buy and sell orders
        if (orderBookCopy.buy.length > 0) {
            orderBookCopy.buy.sort((a, b) => new BigNumber(b.price).comparedTo(a.price) || a.blockTime - b.blockTime);
        }
        if (orderBookCopy.sell.length > 0) {
            orderBookCopy.sell.sort((a, b) => new BigNumber(a.price).comparedTo(b.price) || a.blockTime - b.blockTime);
        }

        console.log(`📈 Orders sorted, beginning matching process...`);

        let iterationLimit = 1000;
        let iterationCount = 0;

        for (; orderBookCopy.buy.length > 0 && orderBookCopy.sell.length > 0; iterationCount++) {
            if (iterationCount >= iterationLimit) {
                console.warn(`⚠️ Match execution limit reached! Exiting.`);
                break;
            }

            let sellOrder = orderBookCopy.sell[0];
            let buyOrder = orderBookCopy.buy[0];

            // Ensure matching distinct property IDs
            if (sellOrder.offeredPropertyId !== buyOrder.desiredPropertyId || sellOrder.desiredPropertyId !== buyOrder.offeredPropertyId) {
                console.warn(`⚠️ Mismatched property IDs, skipping orders.`);
                break;
            }

            let tradePrice;
            let bumpTrade = false;
            let post = false;
            sellOrder.maker = false;
            buyOrder.maker = false;

            // Handle trades in the same block
            if (sellOrder.blockTime === buyOrder.blockTime) {
                tradePrice = buyOrder.price;
                if (sellOrder.post) {
                    tradePrice = sellOrder.price;
                    post = true;
                    sellOrder.maker = true;
                } else if (buyOrder.post) {
                    tradePrice = buyOrder.price;
                    post = true;
                    buyOrder.maker = true;
                }
                sellOrder.flat = true;
            } else {
                tradePrice = sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
                if ((sellOrder.blockTime < buyOrder.blockTime && buyOrder.post) || 
                    (buyOrder.blockTime < sellOrder.blockTime && sellOrder.post)) {
                    bumpTrade = true;
                }
                if (sellOrder.blockTime < buyOrder.blockTime && !bumpTrade) {
                    sellOrder.maker = true;
                } else if (sellOrder.blockTime > buyOrder.blockTime && !bumpTrade) {
                    buyOrder.maker = true;
                }
            }

            if (sellOrder.sender === buyOrder.sender) {
                console.log(`🔄 Self-trade detected, removing maker order.`);
                if (sellOrder.maker) {
                    orderBookCopy.sell.shift();
                } else if (buyOrder.maker) {
                    orderBookCopy.buy.shift();
                }
                continue;
            }

            // Check for price match
            if (new BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                let sellAmountOffered = new BigNumber(sellOrder.amountOffered);
                let sellAmountExpected = new BigNumber(sellOrder.amountExpected);
                let buyAmountOffered = new BigNumber(buyOrder.amountOffered);
                let buyAmountExpected = new BigNumber(buyOrder.amountExpected);

                let tradeAmountA = BigNumber.min(sellAmountOffered, buyAmountExpected);
                let tradeAmountB = tradeAmountA.times(tradePrice);

                console.log(`🔄 Processing trade - Amount A: ${tradeAmountA}, Amount B: ${tradeAmountB}`);

                if (!bumpTrade) {
                    sellOrder.amountOffered = sellAmountOffered.minus(tradeAmountA).toNumber();
                    buyOrder.amountOffered = buyAmountOffered.minus(tradeAmountB).toNumber();
                    sellOrder.amountExpected = sellAmountExpected.minus(tradeAmountB).toNumber();
                    buyOrder.amountExpected = buyAmountExpected.minus(tradeAmountA).toNumber();

                    matches.push({
                        sellOrder: {...sellOrder, amountOffered: tradeAmountA.toNumber()},
                        buyOrder: {...buyOrder, amountExpected: tradeAmountB.toNumber()},
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
                console.log(`❌ No price match, stopping execution.`);
                break;
            }
        }

        console.log(`✅ Matching complete. Trades executed: ${matches.length}`);
        return { orderBook: orderBookCopy, matches: matches };
    }


    async processTokenMatches(matches, blockHeight, txid) {
        if (!Array.isArray(matches) || matches.length === 0) {
            console.log('No valid matches to process')
            return;
        }

        for (const match of matches) {
            if (!match.sellOrder || !match.buyOrder) {
                console.error('Invalid match object:', match)
                continue;
            }

            const sellOrderAddress = match.sellOrder.senderAddress;
            const buyOrderAddress = match.buyOrder.senderAddress;
            const sellOrderPropertyId = match.sellOrder.offeredPropertyId;
            const buyOrderPropertyId = match.buyOrder.desiredPropertyId;

            if (match.sellOrder.blockTime < blockHeight) {
                match.sellOrder.isNew = false
                match.buyOrder.isNew = true
            } else if (match.sellOrder.blockTime == match.buyOrder.blockTime) {
                match.sellOrder.isNew = true
                match.buyOrder.isNew = true
            } else {
                match.buyOrder.isNew = false
                match.sellOrder.isNew = true
            }

            let takerFee, makerRebate, sellOrderAmountChange, buyOrderAmountChange = 0
            let amountToTradeA = new BigNumber(match.amountOfTokenA)
            let amountToTradeB = new BigNumber(match.amountOfTokenB)

            if (txid == "5049a4ac9c8dd3f19278b780135eeb7900b0771e6b9829044900f9fb656b976a") {
                console.log('looking into the problematic tx' + JSON.stringify(match) + 'times ' + match.sellOrder.blockTime + ' ' + match.buyOrder.blockTime)
            }
            console.log('amountTo Trade A and B ' + amountToTradeA + ' ' + amountToTradeB + ' ' + 'match values ' + match.amountOfTokenA + ' ' + match.amountOfTokenB)
            // Determine order roles and calculate fees
            if (match.sellOrder.blockTime < match.buyOrder.blockTime) {
                match.sellOrder.orderRole = 'maker';
                match.buyOrder.orderRole = 'taker';
                takerFee = amountToTradeB.times(0.0002)
                console.log('taker fee ' + takerFee)
                makerRebate = takerFee.div(2)
                console.log('maker fee ' + makerRebate)
                takerFee = takerFee.div(2) //accounting for the half of the taker fee that goes to the maker
                console.log(' actual taker fee ' + takerFee)
                await tallyMap.updateFees(buyOrderPropertyId, takerFee.toNumber())
                console.log('about to calculate this supposed NaN ' + match.amountOfTokenA + ' ' + new BigNumber(match.amountOfTokenA) + ' ' + new BigNumber(match.amountOfTokenA).plus(makerRebate) + ' ' + new BigNumber(match.amountToTradeA).plus(makerRebate).toNumber)
                sellOrderAmountChange = new BigNumber(match.amountOfTokenA).plus(makerRebate).toNumber()
                console.log('sell order amount change ' + sellOrderAmountChange)
                buyOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFee).toNumber()

            } else if (match.buyOrder.blockTime < match.sellOrder.blockTime) {
                match.buyOrder.orderRole = 'maker';
                match.sellOrder.orderRole = 'taker';
                takerFee = amountToTradeA.times(0.0002)
                makerRebate = takerFee.div(2)
                takerFee = takerFee.div(2) //accounting for the half of the taker fee that goes to the maker
                await tallyMap.updateFees(sellOrderPropertyId, takerFee.toNumber())
                buyOrderAmountChange = new BigNumber(match.amountOfTokenA).plus(makerRebate).toNumber()
                sellOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFee).toNumber()
            } else if (match.buyOrder.blockTime == match.sellOrder.blockTime) {
                match.buyOrder.orderRole = 'split';
                match.sellOrder.orderRole = 'split';
                var takerFeeA = amountToTradeA.times(0.0001)
                var takerFeeB = amountToTradeB.times(0.0001)
                await tallyMap.updateFees(buyOrderPropertyId, takerFeeA.toNumber())
                await tallyMap.updateFees(sellOrderPropertyId, takerFeeB.toNumber())
                sellOrderAmountChange = new BigNumber(match.amountOfTokenA).minus(takerFeeA).toNumber()
                buyOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFeeB).toNumber()
            }

            // Debit the traded amount from the seller's reserve 
            await tallyMap.updateBalance(
                match.sellOrder.senderAddress,
                match.sellOrder.offeredPropertyId,
                0,  // Credit traded amount of Token B to available
                -match.amountOfTokenA, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            )
            //and credit the opposite consideration to available

            await tallyMap.updateBalance(
                match.sellOrder.senderAddress,
                match.sellOrder.desiredPropertyId,
                match.amountOfTokenB,  // Credit traded amount of Token B to available
                0, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            )

            // Update balance for the buyer
            // Debit the traded amount from the buyer's reserve and credit it to available
            await tallyMap.updateBalance(
                match.buyOrder.senderAddress,
                match.buyOrder.offeredPropertyId,
                0,  // Credit traded amount of Token B to available
                -match.amountOfTokenB, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            )

            await tallyMap.updateBalance(
                match.buyOrder.senderAddress,
                match.buyOrder.desiredPropertyId,
                match.amountOfTokenA,  // Credit traded amount of Token B to available
                0, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            )

            // Construct a trade object for recording
            const trade = {
                offeredPropertyId: match.sellOrder.offeredPropertyId,
                desiredPropertyId: match.buyOrder.desiredPropertyId,
                amountOffered: match.amountOfTokenA, // or appropriate amount
                amountExpected: match.amountOfTokenB, // or appropriate amount
                price: match.tradePrice,
                buyerRole: match.buyOrder.orderRole,
                sellerRole: match.sellOrder.orderRole,
                takerFee: takerFee,
                makerFee: makerFee,
                block: blockHeight,
                buyer: match.buyOrder.senderAddress,
                seller: match.sellOrder.senderAddress,
                takerTxId: txid
            };

            // Record the token trade
            await this.recordTokenTrade(trade, blockHeight, txid)

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
                initMargin = await ContractRegistry.moveCollateralToReserve(sender, contractId, amount, price,blockTime,txid) //first we line up the capital
            }else if(isBuyerReducingPosition||isSellerReducingPosition){
                initialReduce=true

                let flipAmount = 0;
                if ((sell && existingPosition.contracts > 0 && amount > existingPosition.contracts) ||
                    (!sell && existingPosition.contracts < 0 && amount > Math.abs(existingPosition.contracts))) {
                    // This is a flip!
                    flipAmount = sell
                        ? amount - existingPosition.contracts
                        : amount - Math.abs(existingPosition.contracts);

                    // Move collateral to reserve for only the flipAmount, not the whole order
                    if (flipAmount > 0) {
                        await ContractRegistry.moveCollateralToReserve(sender, contractId, flipAmount, price, blockTime, txid);
                    }
                }
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

async estimateLiquidation(liquidationOrder) {
    const { contractId, amount, sell, price: liqPrice, address } = liquidationOrder;
    console.log('est liq ' + sell);

    // Load the order book for the given contract
    const orderBookKey = `${contractId}`;
    const orderbookData = await this.loadOrderBook(orderBookKey, false);

    let orders = sell ? orderbookData.buy : orderbookData.sell; // Match against the opposite side

    if (!orders || orders.length === 0) {
        return {
            estimatedFillPrice: null,
            filledSize: 0,
            partialFillPercent: 0,
            filled: false,
            filledBelowLiqPrice: false,
            partiallyFilledBelowLiqPrice: false,
            trueBookEmpty: true,
            remainder: amount, // Everything remains unfilled
            liquidationLoss: 0,
            trueLiqPrice: null, // No price available in book
            counterpartyOrders: [] // No matches
        };
    }

    // Sort orders by price (ascending for buy orders, descending for sell orders)
    orders = sell
        ? orders.sort((a, b) => b.price - a.price) // Sell side: match highest bids first
        : orders.sort((a, b) => a.price - b.price); // Buy side: match lowest asks first

    let remainingSize = new BigNumber(amount);
    let totalCost = new BigNumber(0);
    let filledSize = new BigNumber(0);
    let filledBelowLiqPrice = false;
    let partiallyFilledBelowLiqPrice = false;
    let liquidationLoss = new BigNumber(0);
    let trueLiqPrice = null; // Track price where full liquidation would happen
    let liqPriceBN = new BigNumber(liqPrice);
    let counterpartyOrders = []; // Store actual matched orders

    for (let order of orders) {
        if (order.sender == address) continue; // Skip self-trades
        console.log('no skip');

        let orderPriceBN = new BigNumber(order.price);
        let priceDiff = liqPriceBN.minus(orderPriceBN);
        let fillAmount = BigNumber.min(remainingSize, order.amount);

        totalCost = totalCost.plus(fillAmount.times(order.price));
        filledSize = filledSize.plus(fillAmount);
        remainingSize = remainingSize.minus(fillAmount);
        order.sized = fillAmount.decimalPlaces(8).toNumber()
        // Track matched counterparty orders
        counterpartyOrders.push(order);

        // If we go below liquidation price, flag it
        console.log('about to check for systemic loss ' + order.price + ' ' + liqPrice + ' ' + sell);
        if ((order.price < liqPrice && sell) || (order.price > liqPrice && !sell)) {
            filledBelowLiqPrice = true;
            partiallyFilledBelowLiqPrice = filledSize.gt(0) && filledSize.lt(sell);
            liquidationLoss = liquidationLoss.plus(fillAmount.times(priceDiff));
        }

        // Store the last order price where we stopped (for trueLiqPrice)
        trueLiqPrice = order.price;

        if (remainingSize.lte(0)) break;
    }

    let estimatedFillPrice = filledSize.gt(0) ? totalCost.dividedBy(filledSize).toNumber() : null;
    let partialFillPercent = filledSize.dividedBy(amount).times(100).toNumber();
    let trueBookEmpty = remainingSize.gt(0);
    let remainder = remainingSize.toNumber(); // Contracts still unfilled

    return {
        estimatedFillPrice,
        filledSize: filledSize.toNumber(),
        partialFillPercent,
        filled: filledSize.gte(sell),
        filledBelowLiqPrice,
        partiallyFilledBelowLiqPrice,
        trueBookEmpty,
        remainder,
        liquidationLoss: liquidationLoss.decimalPlaces(8).toNumber(),
        trueLiqPrice, // This is the price where remaining contracts could be filled if the book had enough liquidity
        counterpartyOrders // List of actual matched counterparties
    };
}

async matchContractOrders(orderBook) {
  // Base condition: if there are no buy or sell orders, return an empty match array.
  if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
    return { orderBook, matches: [] };
  }

  let matches = [];
  const maxIterations = Math.min(orderBook.buy.length, orderBook.sell.length, 10000); // Safety guard

  // Sort buy orders descending by price and ascending by blockTime,
  // sort sell orders ascending by price and ascending by blockTime.
  orderBook.buy.sort((a, b) =>
    BigNumber(b.price).comparedTo(a.price) || a.blockTime - b.blockTime
  );
  orderBook.sell.sort((a, b) =>
    BigNumber(a.price).comparedTo(b.price) || a.blockTime - b.blockTime
  );

  // Process a round of matching
  for (let i = 0; i < maxIterations; i++) {
    if (orderBook.sell.length === 0 || orderBook.buy.length === 0) break;

    let sellOrder = orderBook.sell[0];
    let buyOrder = orderBook.buy[0];

    console.log('remaining sells ' + JSON.stringify(orderBook.sell));
    console.log('sell order ' + JSON.stringify(sellOrder));

    // Remove orders with zero amounts
    if (BigNumber(sellOrder.amount).isZero()) {
      orderBook.sell.splice(0, 1);
      continue;
    }
    if (BigNumber(buyOrder.amount).isZero()) {
      orderBook.buy.splice(0, 1);
      continue;
    }

    // Check for price match: if the best buy price is below the best sell price, no trade can occur.
    if (BigNumber(buyOrder.price).isLessThan(sellOrder.price)) break;

    // Determine trade price (using the order with the earlier blockTime)
    let tradePrice =
      sellOrder.blockTime < buyOrder.blockTime ? sellOrder.price : buyOrder.price;
    sellOrder.maker = sellOrder.blockTime < buyOrder.blockTime;
    buyOrder.maker = buyOrder.blockTime < sellOrder.blockTime;

    // Prevent self-trading
    const sellSender = sellOrder.sender || sellOrder.address;
    const buySender = buyOrder.sender || buyOrder.address;
    if (sellSender === buySender) {
      console.log("Self-trade detected, removing the maker (resting) order.");
      if (sellOrder.maker) {
        orderBook.sell.splice(0, 1);
      } else {
        orderBook.buy.splice(0, 1);
      }
      continue;
    }

    // For orders in the same block, decide based on the post-only flag.
    if (sellOrder.blockTime === buyOrder.blockTime) {
      console.log("Trades in the same block, defaulting to buy order");
      tradePrice = buyOrder.price;
      if (sellOrder.post) {
        tradePrice = sellOrder.price;
        sellOrder.maker = true;
        buyOrder.maker = false;
      } else if (buyOrder.post) {
        tradePrice = buyOrder.price;
        buyOrder.maker = true;
        sellOrder.maker = false;
      } else {
        sellOrder.maker = false;
        buyOrder.maker = false;
      }
    }

    // Execute trade: match the minimum of the two orders’ amounts.
    let tradeAmount = BigNumber.min(sellOrder.amount, buyOrder.amount);

    // Compute initial margin per contract (and marginUsed)
    const ContractRegistry = require('./contractRegistry.js');
    let initialMarginPerContract = await ContractRegistry.getInitialMargin(
      buyOrder.contractId,
      tradePrice
    );
    if (!initialMarginPerContract || isNaN(initialMarginPerContract)) {
      console.error(
        `Invalid initialMarginPerContract: ${initialMarginPerContract} for contract ${buyOrder.contractId} at price ${tradePrice}`
      );
      initialMarginPerContract = 0;
    }
    let marginUsed = BigNumber(initialMarginPerContract)
      .times(tradeAmount)
      .decimalPlaces(8)
      .toNumber();
    if (isNaN(marginUsed)) {
      console.error(`NaN detected in marginUsed: ${marginUsed}, using default 0`);
      marginUsed = 0;
    }

    // Choose a txid based on maker flag
    let txid = sellOrder.maker ? sellOrder.txid : buyOrder.txid;

    // Construct the match object
    matches.push({
      sellOrder: {
        ...sellOrder,
        contractId: sellOrder.contractId,
        amount: tradeAmount.toNumber(),
        sellerAddress: sellOrder.sender || sellOrder.address,
        sellerTx: sellOrder.txid,
        maker: sellOrder.maker,
        liq: sellOrder.isLiq || false,
        marginUsed: marginUsed,
        initialReduce: sellOrder.initialReduce
      },
      buyOrder: {
        ...buyOrder,
        contractId: buyOrder.contractId,
        amount: tradeAmount.toNumber(),
        buyerAddress: buyOrder.sender || buyOrder.address,
        buyerTx: buyOrder.txid,
        liq: buyOrder.isLiq || false,
        maker: buyOrder.maker,
        marginUsed: marginUsed,
        initialReduce: buyOrder.initialReduce
      },
      tradePrice,
      txid: txid
    });

    // Update order amounts after the match
    sellOrder.amount = BigNumber(sellOrder.amount).minus(tradeAmount).toNumber();
    buyOrder.amount = BigNumber(buyOrder.amount).minus(tradeAmount).toNumber();

    // Remove fully filled orders from the front of the arrays
    if (sellOrder.amount === 0) {
      orderBook.sell.splice(0, 1);
    } else {
      orderBook.sell[0] = sellOrder;
    }
    if (buyOrder.amount === 0) {
      orderBook.buy.splice(0, 1);
    } else {
      orderBook.buy[0] = buyOrder;
    }
  }

  // After this round, if there are still orders and the best buy price is at or above the best sell price,
  // recursively match the remaining orders.
  if (
    orderBook.buy.length > 0 &&
    orderBook.sell.length > 0 &&
    BigNumber(orderBook.buy[0].price).isGreaterThanOrEqualTo(orderBook.sell[0].price)
  ) {
    const recResult = await this.matchContractOrders(orderBook);
    matches = matches.concat(recResult.matches);
    orderBook = recResult.orderBook;
  }

  return { orderBook, matches };
}

    async getAddressOrders(address, sell) {
        // Load the order book for the current instance's contractId
        const orderBookKey = `${this.orderBookKey}`;
        const orderbookData = await this.loadOrderBook(orderBookKey, false);

        if(!orderbookData){
            console.error(`No order book found for contract ${this.orderBookKey}`);
            return [];
        }

        // Determine whether to check buy or sell orders
        let orders = sell ? orderbookData.sell : orderbookData.buy;

        // Filter orders by matching the given address
        return orders.filter(order => order.sender === address);
    }

     async cancelContractOrdersForSize(address, contractId, blockHeight, sell, size) {
        // Load the order book for the current instance's contractId
        const orderBookKey = `${this.orderBookKey}`;
        const orderbookData = await this.loadOrderBook(orderBookKey, false);

        if (!orderbookData) {
            console.error(`No order book found for contract ${this.orderBookKey}`);
            return [];
        }

        // Determine the order side (buy or sell)
        let orders = sell ? orderbookData.sell : orderbookData.buy;

        // Sort orders based on distance from market:
        // - Buy orders: Sort ascending (lowest price first)
        // - Sell orders: Sort descending (highest price first)
        orders = sell
            ? orders.sort((a, b) => a.price - b.price)  // Buy side (cancel lowest first)
            : orders.sort((a, b) => b.price - a.price); // Sell side (cancel highest first)

        let remainingSize = new BigNumber(size);
        let cancelledOrders = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];

            // Only process orders belonging to the given address
            if (order.sender !== address) {
                continue;
            }

            let orderSizeBN = new BigNumber(order.amount);
            let cancelSize = BigNumber.minimum(orderSizeBN, remainingSize);

            // Cancel the order
            cancelledOrders.push({
                txid: order.txid, // Transaction ID of the order being cancelled
                amountCancelled: cancelSize.toNumber(),
                price: order.price,
            });

            // Reduce remaining size to satisfy cancellation
            remainingSize = remainingSize.minus(cancelSize);

            // Remove order from orderbook if fully cancelled
            if (orderSizeBN.isLessThanOrEqualTo(cancelSize)) {
                orders.splice(i, 1);
                i--; // Adjust index since we removed an element
            } else {
                // Update order amount in the order book
                order.amount = orderSizeBN.minus(cancelSize).toNumber();
            }

            // If we have fully satisfied the requested size, stop processing
            if (remainingSize.isLessThanOrEqualTo(0)) {
                break;
            }
        }

        // Save the updated order book
        //await this.saveOrderBook(orderBookKey, orderbookData);

        return cancelledOrders;
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

        // In Orderbooks.js
async adjustOrdersForAddress(address, contractId, tally, pos) {
    const orderBookKey = `${this.orderBookKey}`;
    const orderbook = await this.loadOrderBook(orderBookKey, false);
    const obForContract = orderbook.orderBooks[contractId] || { buy: [], sell: [] };

    console.log(`🔄 Adjusting orders for ${address} on contract ${contractId} with position: ${JSON.stringify(pos)}`);

    let totalInitMarginForAddress = new BigNumber(0);
    let changedOrders = false;
    let requiredMarginChange = new BigNumber(0);

    // Loop through buy & sell sides
    for (const side of ['buy', 'sell']) {
        for (let i = obForContract[side].length - 1; i >= 0; i--) {
            const order = obForContract[side][i];
            const orderAddress = order.sender || order.address;
            if (orderAddress !== address) continue;

            const orderSide = order.side || (order.sell ? 'sell' : 'buy');
            const shouldBeReduce = (orderSide === 'buy' && pos.contracts < 0) ||
                                   (orderSide === 'sell' && pos.contracts > 0);

            if (order.initialReduce !== shouldBeReduce) {
                console.log(`🔄 Order ${order.txid}: initialReduce flipped (${order.initialReduce} → ${shouldBeReduce})`);
                order.initialReduce = shouldBeReduce;
                changedOrders = true;

                if (shouldBeReduce) {
                    // ✅ **Return `initMargin` to `available` since it's now a take-profit order**
                    console.log(`📉 Order ${order.txid} converted to take-profit. Returning ${order.initMargin} to available.`);
                    await TallyMap.updateBalance(address, tally.propertyId, order.initMargin, -order.initMargin, 0, 0, 'takeProfitMarginReturn', tally.block);
                } else {
                    // ❌ **Pull `initMargin` from `available` for new entry orders**
                    console.log(`📈 Order ${order.txid} requires fresh margin allocation.`);
                    requiredMarginChange = requiredMarginChange.plus(order.initMargin);
                }
            }

            // Update margin usage
            const newInitialMargin = await ContractRegistry.getInitialMargin(contractId, pos.avgPrice);
            const expectedMarginUsed = new BigNumber(newInitialMargin).times(order.amount).decimalPlaces(8).toNumber();

            if (order.marginUsed !== expectedMarginUsed) {
                console.log(`🔧 Updating marginUsed ${order.marginUsed} → ${expectedMarginUsed} for Order ${order.txid}`);
                order.marginUsed = expectedMarginUsed;
                changedOrders = true;
            }

            // Track total reserved margin for address
            totalInitMarginForAddress = totalInitMarginForAddress.plus(expectedMarginUsed);
        }
    }

    // **Step 2: Ensure sufficient balance before applying margin changes**
    if (requiredMarginChange.gt(0)) {
        const hasSufficient = await TallyMap.hasSufficientBalance(address, tally.propertyId, requiredMarginChange.toNumber());

        if (!hasSufficient) {
            console.log(`⚠️ Insufficient balance for new entry orders. Cancelling lower-priority orders.`);
            await this.cancelExcessOrders(address, contractId, obForContract, requiredMarginChange);
        } else {
            console.log(`✅ Sufficient balance. Allocating ${requiredMarginChange.toFixed(8)} to margin.`);
            await TallyMap.updateBalance(address, tally.propertyId, -requiredMarginChange.toNumber(), requiredMarginChange.toNumber(), 0, 0, 'reduceFlagReallocation', tally.block);
        }
    }

    // Save updated orderbook
    orderbook.orderBooks[contractId] = obForContract;
    await Orderbooks.saveOrderbook(orderbook);
    console.log(`✅ Finished adjusting orders for ${address} on contract ${contractId}.`);

    return orderbook;
}

static async cancelExcessOrders(address, contractId, obForContract, requiredMargin) {
    let freedMargin = new BigNumber(0);

    console.log(`🚨 Cancelling excess orders for ${address} on contract ${contractId} to free up ${requiredMargin.toFixed(8)} margin.`);

    // Sort sell orders by highest price first (worst price for seller)
    obForContract.sell.sort((a, b) => new BigNumber(b.price).comparedTo(a.price));

    // Sort buy orders by lowest price first (worst price for buyer)
    obForContract.buy.sort((a, b) => new BigNumber(a.price).comparedTo(b.price));

    for (const side of ['buy', 'sell']) {
        for (let i = obForContract[side].length - 1; i >= 0; i--) {
            const order = obForContract[side][i];
            if ((order.sender || order.address) !== address) continue;

            console.log(`❌ Cancelling Order ${order.txid}, freeing ${order.initMargin} margin.`);
            freedMargin = freedMargin.plus(order.initMargin);
            obForContract[side].splice(i, 1); // Remove order

            await TallyMap.updateBalance(address, tally.propertyId, order.initMargin, -order.initMargin, 0, 0, 'excessOrderCancellation', tally.block);

            if (freedMargin.gte(requiredMargin)) {
                console.log(`✅ Enough margin freed. Stopping cancellations.`);
                return;
            }
        }
    }

    console.log(`⚠️ Could not free all required margin. User may still be undercollateralized.`);
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
            const trades= []
            //console.log('processing contract mathces '+JSON.stringify(matches))
            let counter = 0 
            for (const match of matches) {
                counter+=1
                  console.log('bleh 🛑 '+counter+' '+JSON.stringify(matches))
                  console.log('🛑 JSON.stringify match '+JSON.stringify(match))

                    if(match.buyOrder.buyerAddress == match.sellOrder.sellerAddress){
                        console.log('self trade nullified '+match.buyOrder.buyerAddress)
                        continue
                    }

                    let debugFlag = false
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
                    console.log('checking positions '+JSON.stringify(match.buyerPosition)+' '+JSON.stringify(match.sellerPosition))
                    const isBuyerReducingPosition = Boolean(match.buyerPosition.contracts < 0);
                    const isSellerReducingPosition = Boolean(match.sellerPosition.contracts > 0);
                   
                    console.log('about to calc fee '+match.buyOrder.amount+' '+match.sellOrder.maker+' '+match.buyOrder.maker+' '+isInverse+' '+match.tradePrice+' '+notionalValue+' '+channel)
                    let buyerFee = new BigNumber(this.calculateFee(match.buyOrder.amount,match.sellOrder.maker,match.buyOrder.maker,isInverse,
						true, match.tradePrice, notionalValue,channel ));

					let sellerFee = new BigNumber(this.calculateFee(match.sellOrder.amount,match.sellOrder.maker,match.buyOrder.maker,isInverse,
					    false,match.tradePrice,notionalValue,channel));
					console.log('seller/buyer fee '+sellerFee+' '+buyerFee)
					// Buyer side: only push taker/on-chain positive fees
					if (buyerFee.isGreaterThan(0)&&sellerFee.isLessThan(0)) {
					  const feeToCache = buyerFee.div(2).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber();
					  console.log('buyer fee to cache '+feeToCache)
					  await TallyMap.updateFeeCache(collateralPropertyId, feeToCache, match.buyOrder.contractId);
					}

					// Seller side: same treatment
					if (sellerFee.isGreaterThan(0)&&buyerFee.isLessThan(0)) {
					  const feeToCache = sellerFee.div(2).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber();
					  console.log('seller fee to cache '+feeToCache)
					  await TallyMap.updateFeeCache(collateralPropertyId, feeToCache, match.sellOrder.contractId);
					}

					if(buyerFee.isGreaterThan(0)&&sellerFee.isGreaterThan(0)){
					  await TallyMap.updateFeeCache(collateralPropertyId, sellerFee.decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(), match.sellOrder.contractId);
					  await TallyMap.updateFeeCache(collateralPropertyId, buyerFee.decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(), match.sellOrder.contractId);
					}

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
                    let initialMarginPerContract = await ContractRegistry.getInitialMargin(match.buyOrder.contractId, match.tradePrice);
                    let buyerFullyClosed =false
                    let sellerFullyClosed = false
                    
                        console.log('debug flag flags '+isBuyerFlippingPosition+isSellerFlippingPosition+isBuyerReducingPosition+isSellerReducingPosition)

                    if (isBuyerFlippingPosition) {
                        let closedContracts = Math.abs(match.buyerPosition.contracts); // The contracts being closed
                        flipLong = match.buyOrder.amount - closedContracts; // New contracts beyond closing

                        if (feeInfo.buyFeeFromMargin) {
                            match.buyOrder.marginUsed = BigNumber(match.buyOrder.marginUsed).minus(buyerFee).decimalPlaces(8).toNumber();
                        }

                        console.log(`Checking flip logic: ${match.buyOrder.buyerAddress} closing ${closedContracts}, flipping ${flipLong}`);
                        let newMarginRequired = BigNumber(initialMarginPerContract).times(flipLong).decimalPlaces(8).toNumber();
                        console.log('newMargin flip '+newMarginRequired+' '+initialMarginPerContract+' '+flipLong)
                        if(!channel){
                            // Release margin for closed contracts
                            let marginToRelease = BigNumber(initialMarginPerContract).times(closedContracts).decimalPlaces(8).toNumber();
                            //so in the event that this is not a channel trade we will deduct this as it matches the book
                            await TallyMap.updateBalance(
                                match.buyOrder.buyerAddress, collateralPropertyId, marginToRelease, -marginToRelease, 0, 0, 
                                'contractMarginRelease', currentBlockHeight
                            );
                        }else if(channel){
                           let diff = BigNumber(newMarginRequired).minus(match.buyerPosition.margin || 0).decimalPlaces(8).toNumber();
                            if (diff !== 0) await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, -diff, 0, diff, 0, 'contractTradeInitMargin_channelFlip', currentBlockHeight);

                        }

                        // Ensure there is enough margin for the new contracts beyond closing
                        let hasSufficientBalance = await TallyMap.hasSufficientBalance(match.buyOrder.buyerAddress, collateralPropertyId, newMarginRequired);
                        
                        if (!hasSufficientBalance.hasSufficient) {
                            console.log(`Shortfall detected: ${JSON.stringify(hasSufficientBalance)}`);
                            console.log('hasSuf '+hasSufficientBalance.shortfall+' '+initialMarginPerContract )
                            let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                                .dividedBy(initialMarginPerContract)
                                .decimalPlaces(0, BigNumber.ROUND_CEIL)
                                .toNumber();

                            flipLong -= contractUndo;
                            newMarginRequired = BigNumber(initialMarginPerContract).times(new BigNumber(flipLong)).decimalPlaces(8).toNumber();
                            console.log('contract undo investigate '+newMarginRequired+' '+flipLong+' '+contractUndo+' '+BigNumber(hasSufficientBalance.shortfall)
                                .dividedBy(initialMarginPerContract)+' '+BigNumber(hasSufficientBalance.shortfall)
                                .dividedBy(initialMarginPerContract)
                                .decimalPlaces(0, BigNumber.ROUND_CEIL))                            
                        }

                        await TallyMap.updateBalance(
                            match.buyOrder.buyerAddress, collateralPropertyId, -newMarginRequired, 0, newMarginRequired, 0, 
                            'contractTradeInitMargin', currentBlockHeight
                        );

                        await marginMap.setInitialMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId, newMarginRequired);
                        await marginMap.recordMarginMapDelta(match.buyOrder.buyerAddress, match.buyOrder.contractId, 
                            match.buyerPosition.contracts + match.buyOrder.amount, match.buyOrder.amount, 0, 0, 0, 
                            'updateContractBalancesFlip',currentBlockHeight
                        );

                        let refreshedBalance = await TallyMap.getTally(match.buyOrder.buyerAddress,collateralPropertyId)
                        //this.adjustOrdersForAddress(match.buyOrder.buyerAddress, match.buyOrder.contractId, refreshedBalance, match.buyerPosition)

                        buyerFullyClosed = true;
                        console.log(`Flip logic updated: closed=${closedContracts}, flipped=${flipLong}`);
                    }
                    
                    if(isSellerFlippingPosition){
                        let closedContracts = Math.abs(match.sellerPosition.contracts); // The contracts being closed
                        flipShort = match.sellOrder.amount - closedContracts; // New contracts beyond closing

                        console.log(`Checking sell flip logic: ${match.sellOrder.sellerAddress} closing ${closedContracts}, flipping ${flipShort}`);

                        console.log(`Checking flip logic: ${match.buyOrder.buyerAddress} closing ${closedContracts}, flipping ${flipLong}`);
                        let newMarginRequired = BigNumber(initialMarginPerContract).times(flipShort).decimalPlaces(8).toNumber();
                        console.log('newMargin flip '+newMarginRequired+' '+initialMarginPerContract+' '+flipLong)
                        if(!channel){
                            // Release margin for closed contracts
                            let marginToRelease = BigNumber(initialMarginPerContract).times(closedContracts).decimalPlaces(8).toNumber();
                            //so in the event that this is not a channel trade we will deduct this as it matches the book
                            await TallyMap.updateBalance(
                                match.sellOrder.sellerAddress, collateralPropertyId, marginToRelease, -marginToRelease, 0, 0, 
                                'contractMarginRelease', currentBlockHeight
                            );
                        }else if(channel){
                            let diff = BigNumber(newMarginRequired).minus(match.sellerPosition.margin || 0).decimalPlaces(8).toNumber();
                            if (diff !== 0) await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, -diff, 0, diff, 0, 'contractTradeInitMargin_channelFlip', currentBlockHeight);
                        }

                        if (feeInfo.sellFeeFromMargin) {
                            newMarginRequired = BigNumber(newMarginRequired).minus(sellerFee).decimalPlaces(8).toNumber();
                        }

                        let hasSufficientBalance = await TallyMap.hasSufficientBalance(match.sellOrder.sellerAddress, collateralPropertyId, newMarginRequired);
                        
                        if (!hasSufficientBalance.hasSufficient) {
                            console.log(`Sell flip shortfall detected: ${JSON.stringify(hasSufficientBalance)}`);
                            let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                                .dividedBy(initialMarginPerContract)
                                .decimalPlaces(0, BigNumber.ROUND_CEIL)
                                .toNumber();

                            flipShort -= contractUndo;
                            newMarginRequired = BigNumber(initialMarginPerContract).times(new BigNumber(flipShort)).decimalPlaces(8).toNumber();
                        }

                        await TallyMap.updateBalance(
                            match.sellOrder.sellerAddress, collateralPropertyId, -newMarginRequired, 0, newMarginRequired, 0, 
                            'contractTradeInitMargin', currentBlockHeight
                        );

                        await marginMap.setInitialMargin(match.sellOrder.sellerAddress, match.sellOrder.contractId, newMarginRequired);
                        await marginMap.recordMarginMapDelta(match.sellOrder.sellerAddress, match.sellOrder.contractId, 
                            match.sellerPosition.contracts - match.sellOrder.amount, match.sellOrder.amount, 0, 0, 0, 
                            'updateContractBalancesFlip',currentBlockHeight
                        );

                        let refreshedBalanceB = await TallyMap.getTally(match.sellOrder.sellerAddress,collateralPropertyId)
                        //this.adjustOrdersForAddress(match.sellOrder.sellerAddress, match.sellOrder.contractId, refreshedBalanceB, match.sellerPosition)

                        sellerFullyClosed = true;
                        console.log(`Sell flip logic updated: closed=${closedContracts}, flipped=${flipShort}`);
                    }

                    console.log('about to go into logic brackets for init margin '+isBuyerReducingPosition + ' seller reduce? '+ isSellerReducingPosition+ ' channel? '+channel)
                
                    console.log('looking at feeInfo obj '+JSON.stringify(feeInfo))
                    if(!isBuyerReducingPosition&&!match.buyOrder.liq){
                        if(channel==false){
                            // Use the instance method to set the initial margin
                            console.log('moving margin buyer not channel not reducing '+counter+' '+match.buyOrder.buyerAddress+' '+match.buyOrder.contractId+' '+match.buyOrder.amount+' '+match.buyOrder.marginUsed)
                            const txid = match?.txid || '';
                            match.buyerPosition = await ContractRegistry.moveCollateralToMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId,match.buyOrder.amount, match.tradePrice, match.buyOrder.price,false,match.buyOrder.marginUsed,channel,null,currentBlockHeight,feeInfo,match.buyOrder.maker,debugFlag,txid)
                            console.log('looking at feeInfo obj '+JSON.stringify(feeInfo))
                        }else if(channel==true){
                            console.log('moving margin buyer channel not reducing '+counter+' '+match.buyOrder.buyerAddress+' '+match.buyOrder.contractId+' '+match.buyOrder.amount+' '+match.buyOrder.marginUsed)
                            const txid = match?.txid || '';
                            match.buyerPosition = await ContractRegistry.moveCollateralToMargin(match.buyOrder.buyerAddress, match.buyOrder.contractId,match.buyOrder.amount, match.buyOrder.price, match.buyOrder.price,false,match.buyOrder.marginUsed,channel, match.channelAddress,currentBlockHeight,feeInfo,match.buyOrder.maker,debugFlag,txid)                  
                        }
                        //console.log('buyer position after moveCollat '+match.buyerPosition)
                    }
                    // Update MarginMap for the contract series
                    console.log(' addresses in match '+match.buyOrder.buyerAddress+' '+match.sellOrder.sellerAddress)
                    if(!isSellerReducingPosition&&!match.sellOrder.liq){
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

                    let positions = await marginMap.updateContractBalancesWithMatch(match, channel, buyerClosed,flipLong,sellerClosed,flipShort,currentBlockHeight)
                 
                    const isLiq = Boolean(match.sellOrder.liq||match.buyOrder.liq)
                    console.log(JSON.stringify(match.sellOrder))
                    const trade = {
                        buyerPosition: match.buyerPosition,
                        sellerPosition: match.sellerPosition,
                        buyerFee: buyerFee.decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
                        sellerFee: sellerFee.decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
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
                        channel: channel,
                        liquidation: isLiq
                        // other relevant trade details...
                    };

                    console.log('trade '+JSON.stringify(trade))
                    match.buyerPosition = positions.bp
                    match.sellerPosition = positions.sp
                    console.log('checking positions based on mMap vs. return of object in contract update '+JSON.stringify(positions)+' '+JSON.stringify(match.buyerPosition) + ' '+JSON.stringify(match.sellerPosition))

                    console.log('checking positions after contract adjustment, seller '+JSON.stringify(match.sellerPosition) + ' buyer '+JSON.stringify(match.buyerPosition))

                    // Record the contract trade
                    await this.recordContractTrade(trade, currentBlockHeight);
                    // Determine if the trade reduces the position size for buyer or seller
                    let lastMark = await ContractRegistry.getPriceAtBlock(trade.contractId, currentBlockHeight)
                    console.log('LAST MARK '+lastMark+' '+match.buyerPosition.lastMark+' '+match.sellerPosition.lastMark+' '+JSON.stringify(match.buyerPosition))
                    if(lastMark==null){lastMark=trade.price}
                    if(match.buyerPosition.lastMark==null){
                        match.buyerPosition.newFlag=true
                    }
                    if(match.sellerPosition.lastMark==null){
                        match.sellerPosition.newFlag=true
                    }
                    console.log(lastMark)  
                    let buyerMark = lastMark
                    let sellerMark = lastMark
                    if(match.buyerPosition.lastMark!==lastMark&&match.buyerPosition.lastMark){
                        buyerMark = match.buyerPosition.lastMark
                    }
                    if(match.sellerPosition.lastMark!==lastMark&&match.sellerPosition.lastMark){
                        sellerMark = match.sellerPosition.lastMark
                    }    

                    console.log('buyerMark '+match.buyerPosition.lastMark+' '+buyerMark)
                    console.log('sellerMark '+match.sellerPosition.lastMark+' '+sellerMark)
                    // Realize PnL if the trade reduces the position size
                    let buyerPnl = 0, sellerPnl = 0;
                    console.log('do we realize PNL? '+isBuyerReducingPosition+' '+isBuyerFlippingPosition+' '+match.buyOrder.liq+' '+isSellerReducingPosition+' '+isSellerFlippingPosition+' '+match.sellOrder.liq)
                    let closedShorts=0
                    if((isBuyerReducingPosition||isBuyerFlippingPosition)/*&&!match.buyOrder.liq*/){
                        closedShorts = match.buyOrder.amount

                        if(isBuyerFlippingPosition){
                            closedShorts-=flipLong
                        }
                        console.log('closed contracts '+match.buyOrder.amount+' '+closedShorts)
                        //this loops through our position history and closed/open trades in that history to figure a precise entry price for the trades 
                        //on a LIFO basis that are being retroactively 'closed' by reference here
                        //console.log('about to call trade history manager '+match.buyOrder.contractId)
                        //const LIFO = tradeHistoryManager.calculateLIFOEntry(match.buyOrder.buyerAddress, closedContracts, match.buyOrder.contractId)
                        //{AvgEntry,blockTimes}
                        let avgEntry = match.buyerPosition.avgPrice 
                        //then we take that avg. entry price, not for the whole position but for the chunk that is being closed
                        //and we figure what is the PNL that one would show on their taxes, to save a record.
                
                        match.buyerPosition = await marginMap.realizePnl(match.buyOrder.buyerAddress, closedShorts, match.tradePrice, avgEntry, isInverse, perContractNotional, match.buyerPosition, true,match.buyOrder.contractId);
                        //then we will look at the last settlement mark price for this contract or default to the LIFO Avg. Entry if
                        //the closing trade and the opening trades reference happened in the same block (exceptional, will add later)
                        const settlementPNL = await marginMap.settlePNL(match.buyOrder.buyerAddress, -closedShorts, match.tradePrice, buyerMark, match.buyOrder.contractId, currentBlockHeight,isInverse,perContractNotional) 
                        //then we figure out the aggregate position's margin situation and liberate margin on a pro-rata basis 
                        const reduction = await marginMap.reduceMargin(match.buyerPosition, closedShorts, initialMarginPerContract, match.buyOrder.contractId, match.buyOrder.buyerAddress, false, feeInfo.buyFeeFromMargin,buyerFee)
                        //{netMargin,mode}
                        const sufficientMargin = await TallyMap.hasSufficientMargin(match.buyOrder.buyerAddress,collateralPropertyId,reduction)
                          
                        if(reduction!==0&&sufficientMargin.hasSufficient){
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
                        let debit = 0
                        if(settlementPNL<0){
                            debit = Math.abs(settlementPNL)
                        }
                        const sufficient = await TallyMap.hasSufficientBalance(match.buyOrder.buyerAddress,collateralPropertyId,debit)
                        if(reduction.mode!='maint'&&sufficient.hasSufficient){
                            await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, /*accountingPNL*/settlementPNL, 0, 0/*-settlementPNL*/, 0, 'contractTradeSettlement',currentBlockHeight);
                        }else if(!sufficient.hasSufficient){
                            const sufficientMargin = await TallyMap.hasSufficientMargin(match.buyOrder.buyerAddress,collateralPropertyId,debit) 
                            if(sufficientMargin.hasSufficient){
                                await TallyMap.updateBalance(match.buyOrder.buyerAddress, collateralPropertyId, reduction, 0, -debit, 0, 'contractTradeMarginSettlement',currentBlockHeight)
                            }
                        } 
                        if(reduction.mode=='shortfall'){
                            //check the address available balance for the neg. balance
                            //if there's enough in available then do a tallyMap shuffle
                            //otherwise go to insurance or maybe post a system loss at the bankruptcy price and see if it can get cleared before tapping the ins. fund
                        }

                        
                        const savePNLParams = {height:currentBlockHeight, contractId:match.buyOrder.contractId, accountingPNL: match.buyerPosition.realizedPNL, isBuyer: true, 
                            address: match.buyOrder.buyerAddress, amount: closedShorts, tradePrice: match.tradePrice, collateralPropertyId: collateralPropertyId,
                            timestamp: new Date().toISOString(), txid: match.buyOrder.buyerTx, settlementPNL: settlementPNL, marginReduction:reduction, avgEntry: avgEntry}
                        //console.log('preparing to call savePNL with params '+JSON.stringify(savePNLParams))
                        tradeHistoryManager.savePNL(savePNLParams)
                    }

                    if ((isSellerReducingPosition||isSellerFlippingPosition)/*&&!match.sellOrder.liq*/){
                        let closedContracts = match.sellOrder.amount

                        if(isSellerFlippingPosition){
                            closedContracts-=flipShort
                        }
                        let avgEntry = match.sellerPosition.avgPrice
                      
                        console.log('position before realizePnl '+JSON.stringify(match.sellerPosition))
                        match.sellerPosition = await marginMap.realizePnl(match.sellOrder.sellerAddress, closedContracts, match.tradePrice, avgEntry, isInverse, perContractNotional, match.sellerPosition, false,match.sellOrder.contractId);
                        //then we will look at the last settlement mark price for this contract or default to the LIFO Avg. Entry if
                        //the closing trade and the opening trades reference happened in the same block (exceptional, will add later)
                        
                        console.log('position before settlePNL '+JSON.stringify(match.sellerPosition))
                        const settlementPNL = await marginMap.settlePNL(match.sellOrder.sellerAddress, closedContracts, match.tradePrice, sellerMark, match.sellOrder.contractId,currentBlockHeight,isInverse) 
                        //then we figure out the aggregate position's margin situation and liberate margin on a pro-rata basis 
                        console.log('position before going into reduce Margin '+closedContracts+' '+flipShort+' '+match.sellOrder.amount/*JSON.stringify(match.sellerPosition)*/)
                        const reduction = await marginMap.reduceMargin(match.sellerPosition, closedContracts, initialMarginPerContract, match.sellOrder.contractId, match.sellOrder.sellerAddress, false, feeInfo.sellFeeFromMargin, sellerFee)
                        console.log('sell reduction '+JSON.stringify(reduction))
                        //{netMargin,mode} 
                        const sufficientMargin = await TallyMap.hasSufficientMargin(match.sellOrder.sellerAddress,collateralPropertyId,reduction)
                        
                        if(reduction !==0&&sufficientMargin.hasSufficient){
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, reduction, 0, -reduction, 0, 'contractTradeMarginReturn',currentBlockHeight)              
                        } //then we move the settlementPNL out of margin assuming that the PNL is not exactly equal to maintainence margin
                        //the other modes (for auditing/testing) would be, PNL is positive and you get back init. margin 'profit'
                        //PNL is positive and you get back some fraction of the init. margin that was previously settled out 'fractionalProfit'
                        //PNL is negative and you get back more than maint. margin but of course less than init. margin 'moreThanMaint'
                        //PNL is negative and you get back <= maintainence margin which hasn't yet cleared/topped-up 'lessThanMaint'
                        //PNL is negative and all the negative PNL has exactly matched the maintainence margin which won't need to be topped up,
                        //unusual edge case but we're covering it here 'maint'
                        let debit = 0
                        if(settlementPNL<0){
                            debit = Math.abs(settlementPNL)
                        }
                        const sufficient = await TallyMap.hasSufficientBalance(match.sellOrder.sellerAddress,collateralPropertyId,debit)
                        console.log('debit '+debit +' '+settlementPNL+ ' '+JSON.stringify(sufficient))
                        if(reduction.mode!='maint'&&sufficient.hasSufficient){
                            await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, /*accountingPNL*/settlementPNL, 0, 0, 0, 'contractTradeSettlement',currentBlockHeight);
                        }else if(!sufficient.hasSufficient){
                            let again = await TallyMap.hasSufficientMargin(match.sellOrder.sellerAddress,collateralPropertyId,debit)            
                            if(again.hasSufficient){
                                await TallyMap.updateBalance(match.sellOrder.sellerAddress, collateralPropertyId, reduction, 0, -debit, 0, 'contractTradeMarginSettlement',currentBlockHeight)
                            }
                        } 
                       const savePNLParams = {height:currentBlockHeight, contractId:match.sellOrder.contractId, accountingPNL: match.sellerPosition.realizedPNL, isBuyer:false, 
                            address: match.sellOrder.sellerAddress, amount: closedContracts, tradePrice: match.tradePrice, collateralPropertyId: collateralPropertyId,
                            timestamp: new Date().toISOString(), txid: match.sellOrder.sellerTx, settlementPNL: settlementPNL, marginReduction:reduction, avgEntry: avgEntry}
                        //console.log('preparing to call savePNL with params '+JSON.stringify(savePNLParams))
                        tradeHistoryManager.savePNL(savePNLParams)
                    }

                    const contractLTCValue = await VolumeIndex.getContractUnitLTCValue(trade.contractId)
                    const totalContractsLTCValue = new BigNumber(contractLTCValue).times(trade.amount).decimalPlaces(8).toNumber()
                    if (!Number.isFinite(Number(totalContractsLTCValue))) {
                      throw new Error(`${contractLTCValue} ${trade.amount}`);
                    }
                    console.log('contract LTC Value '+contractLTCValue)
                    if(contractLTCValue==0){throw new Error()}
      			await VolumeIndex.saveVolumeDataById(
                        trade.contractId,
                        trade.amount,
                        totalContractsLTCValue,
                        trade.price,
                        trade.block,
                        'contract')

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
                    await marginMap.saveMarginMap(currentBlockHeight);  
                    trades.push(trade)                     
            }
             return trades
		        }
		/**
		 * calculateFee
		 * - Positive result  => taker fee (debit)
		 * - Negative result  => maker rebate (credit)
		 *
		 * Inputs:
		 *  amount:           trade size (contracts or units)
		 *  columnAIsSeller:  bool
		 *  columnAIsMaker:   bool | undefined  (legacy tx may omit)
		 *  isInverse:        bool
		 *  isBuyer:          bool  (this side is the buyer?)
		 *  lastMark:         price used to value notional
		 *  notionalValue:    contract notional
		 *  channel:          bool (true = off-chain channel => fees ÷ 10)
		 */
		calculateFee(amount, sellMaker, buyMaker, isInverse, isBuyer, lastMark, notionalValue, channel) {
		  const BNnotionalValue = new BigNumber(notionalValue);
		  const BNlastMark      = new BigNumber(lastMark);
		  const BNamount        = new BigNumber(amount);

		  const baseFee = (bps) =>
		    isInverse
		      ? new BigNumber(bps).times(BNnotionalValue).div(BNlastMark).times(BNamount)
		      : new BigNumber(bps).times(BNlastMark).div(BNnotionalValue).times(BNamount);

		  let takerRate = new BigNumber(0.0005);    // +5 bps
		  let makerRate = new BigNumber(-0.00025);  // –2.5 bps
		  if (channel === true) {
		    takerRate = takerRate.div(10);          // +0.5 bps
		    makerRate = makerRate.div(10);          // –0.25 bps
		  }

		  console.log('calculate fee '+buyMaker+' '+sellMaker+' '+channel+' '+takerRate+' '+makerRate)

		  // Defensive normalization: if both false, assign one maker/taker to avoid double-billing or double-rebating
		  if (!sellMaker && !buyMaker) {
		    if (isBuyer) {
		      // treat seller as maker for buyer's perspective; buyer = taker
		      return baseFee(takerRate).decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
		    } else {
		      // for seller's perspective; seller = taker
		      return baseFee(takerRate).decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
		    }
		  }

		  if (sellMaker && !buyMaker) {
		    return (isBuyer ? baseFee(takerRate) : baseFee(makerRate))
		      .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
		  }

		  if (!sellMaker && buyMaker) {
		    return (isBuyer ? baseFee(makerRate) : baseFee(takerRate))
		      .decimalPlaces(8, BigNumber.ROUND_CEIL).toNumber();
		  }

		  // Both true should never happen; neutralize
		  return 0;
		}

		resolveMaker(columnAIsSeller, columnAIsMaker) {
		  const makerIsA = (columnAIsMaker === true)
		    ? true
		    : (columnAIsMaker === false)
		      ? false
		      : !columnAIsSeller;          // inference for legacy tx
		  return {
		    sellerMaker: columnAIsSeller && makerIsA,
		    buyerMaker:  !columnAIsSeller && makerIsA,
		  };
		}

  async locateFee(
		  match,
		  reserveBalanceA,
		  reserveBalanceB,
		  collateralPropertyId,
		  buyerFee,                  // signed: >0 taker debit, <0 maker rebate
		  sellerFee,                 // signed: >0 taker debit, <0 maker rebate
		  isBuyerReducingPosition,
		  isSellerReducingPosition,
		  block,
		  isLiq,
		  cacheAdd = 0               // ⬅️ sum of feeCache writes for this match (Number), default 0
		) {
		  const TallyMap = require('./tally.js');
		  const MarginMap = require('./marginMap.js');
		  const marginMap = await MarginMap.loadMarginMap(match.sellOrder.contractId);

		  const RD = BigNumber.ROUND_DOWN;
		  buyerFee  = new BigNumber(buyerFee).decimalPlaces(8, RD).toNumber();
		  sellerFee = new BigNumber(sellerFee).decimalPlaces(8, RD).toNumber();
		  cacheAdd  = new BigNumber(cacheAdd).decimalPlaces(8, RD).toNumber();

		  let buyFeeFromMargin = false;
		  let buyFeeFromReserve = false;
		  let buyFeeFromAvailable = false;
		  let sellFeeFromMargin = false;
		  let sellFeeFromReserve = false;
		  let sellFeeFromAvailable = false;

		  const feeInfo = {
		    sellFeeFromAvailable,
		    sellFeeFromReserve,
		    sellFeeFromMargin,
		    buyFeeFromAvailable,
		    buyFeeFromReserve,
		    buyFeeFromMargin,
		    sellerFee,
		    buyerFee,
		  };

		  console.log('🔍 [locateFee] Checking balances to apply fees...');
		  console.log('🧾 Buyer fee:', buyerFee, ', Seller fee:', sellerFee, ', Property:', collateralPropertyId);

		  const buyerAddr = match.buyOrder.buyerAddress;
		  const sellerAddr = match.sellOrder.sellerAddress;
		  const txid = match.txid || `contract-fee-${block}`;

		  // -------- BUYER SIDE --------
		  if (buyerFee < 0) {
		    // Negative = rebate → always credit
		    await TallyMap.updateBalance(
		      buyerAddr, collateralPropertyId,
		      -buyerFee, 0, 0, 0, 'contractFeeRebate', block, txid
		    );
		    feeInfo.buyFeeFromAvailable = true;
		    console.log('💚 Credited buyer rebate (available):', new BigNumber(-buyerFee).toFixed(8));
		  } else if (buyerFee > 0) {
		    // Positive = debit → sufficiency gates
		    let buyerAvail   = (await TallyMap.hasSufficientBalance(buyerAddr, collateralPropertyId, buyerFee)).hasSufficient;
		    let buyerReserve = (await TallyMap.hasSufficientReserve(buyerAddr, collateralPropertyId, buyerFee)).hasSufficient;
		    let buyerMargin  = (await TallyMap.hasSufficientMargin(buyerAddr, collateralPropertyId, buyerFee)).hasSufficient;

		    console.log(`🧾 Buyer available: ${buyerAvail}, reserve: ${buyerReserve}, margin: ${buyerMargin}`);

		    if (buyerAvail) {
		      await TallyMap.updateBalance(buyerAddr, collateralPropertyId, -buyerFee, 0, 0, 0, 'contractFee', block, txid);
		      feeInfo.buyFeeFromAvailable = true;
		      console.log('💰 Buyer fee from available');
		    } else if (buyerReserve) {
		      await TallyMap.updateBalance(buyerAddr, collateralPropertyId, 0, -buyerFee, 0, 0, 'contractFee', block, txid);
		      feeInfo.buyFeeFromReserve = true;
		      console.log('💰 Buyer fee from reserve');
		    } else if (buyerMargin) {
		      await TallyMap.updateBalance(buyerAddr, collateralPropertyId, 0, 0, -buyerFee, 0, 'contractFee', block, txid);
		      feeInfo.buyFeeFromMargin = true;
		      console.log('💰 Buyer fee from margin');
		    } else {
		      console.warn('⚠️ Buyer fee could not be debited from any source.');
		    }

		  }

		  // -------- SELLER SIDE --------
		  if (sellerFee < 0) {
		    await TallyMap.updateBalance(
		      sellerAddr, collateralPropertyId,
		      -sellerFee, 0, 0, 0, 'contractFeeRebate', block, txid
		    );
		    feeInfo.sellFeeFromAvailable = true;
		    console.log('💚 Credited seller rebate (available):', new BigNumber(-sellerFee).toFixed(8));
		  } else if (sellerFee > 0) {
		    let sellerAvail   = (await TallyMap.hasSufficientBalance(sellerAddr, collateralPropertyId, sellerFee)).hasSufficient;
		    let sellerReserve = (await TallyMap.hasSufficientReserve(sellerAddr, collateralPropertyId, sellerFee)).hasSufficient;
		    let sellerMargin  = (await TallyMap.hasSufficientMargin(sellerAddr, collateralPropertyId, sellerFee)).hasSufficient;

		    console.log(`🧾 Seller available: ${sellerAvail}, reserve: ${sellerReserve}, margin: ${sellerMargin}`);

		    if (sellerAvail) {
		      await TallyMap.updateBalance(sellerAddr, collateralPropertyId, -sellerFee, 0, 0, 0, 'contractFee', block, txid);
		      feeInfo.sellFeeFromAvailable = true;
		      console.log('💰 Seller fee from available');
		    } else if (sellerReserve) {
		      await TallyMap.updateBalance(sellerAddr, collateralPropertyId, 0, -sellerFee, 0, 0, 'contractFee', block, txid);
		      feeInfo.sellFeeFromReserve = true;
		      console.log('💰 Seller fee from reserve');
		    } else if (sellerMargin) {
		      await TallyMap.updateBalance(sellerAddr, collateralPropertyId, 0, 0, -sellerFee, 0, 'contractFee', block, txid);
		      feeInfo.sellFeeFromMargin = true;
		      console.log('💰 Seller fee from margin');
		    } else {
		      console.warn('⚠️ Seller fee could not be debited from any source.');
		    }
		  }

		  // -------- Reconciliation log (per match) --------
		  const takerPos = new BigNumber(Math.max(buyerFee, 0)).plus(Math.max(sellerFee, 0)).decimalPlaces(8, RD);
		  const makerNeg = new BigNumber(Math.max(-buyerFee, 0)).plus(Math.max(-sellerFee, 0)).decimalPlaces(8, RD);
		  const cacheBN  = new BigNumber(cacheAdd).decimalPlaces(8, RD);
		  const net      = takerPos.negated().plus(makerNeg).plus(cacheBN).decimalPlaces(8, RD);

		  console.log('[recon]',
		    'takerPos=', takerPos.toFixed(),
		    'makerNeg=', makerNeg.toFixed(),
		    'cacheAdd=', cacheBN.toFixed(),
		    'net=', net.toFixed()
		  );

		  console.log('✅ [locateFee] Fee sources determined:', JSON.stringify(feeInfo, null, 2));
		  return feeInfo;
		}


async processContractMatchesShort(matches, currentBlockHeight, channel) {
  const TallyMap = require('./tally.js');
  const ContractRegistry = require('./contractRegistry.js');
  const MarginMap = require('./marginMap.js');
  const tradeHistoryManager = new TradeHistory();

  if (!Array.isArray(matches)) {
      console.error('Matches is not an array:', matches);
      matches = [];
  }

  let counter = 0;
  for (const match of matches) {
    counter++;
    console.log(`Processing match ${counter}: ${JSON.stringify(match)}`);

    // 1. Validate match and load up-to-date state.
    if (match.buyOrder.buyerAddress === match.sellOrder.sellerAddress) {
      console.log(`Self-trade nullified for ${match.buyOrder.buyerAddress}`);
      continue;
    }
    await validateMatch(match);

    // 2. Calculate fees & update fee caches.
    const feeInfo = await calculateFees(match, channel);
    // 3. Determine if flip logic applies and update collateral.
    const flipData = await handleFlipLogic(match, feeInfo, currentBlockHeight);
    
    // 4. Adjust collateral for non-reducing orders.
    await moveCollateral(match, feeInfo, channel, currentBlockHeight);
    
    // 5. Update contract balances (positions) using the match.
    const updatedPositions = await updateContractBalances(match, channel, flipData);
    match.buyerPosition = updatedPositions.bp;
    match.sellerPosition = updatedPositions.sp;

    // 6. Settle PnL if the trade reduces the position.
    await realizePnLAndSettle(match, currentBlockHeight);

    // 7. Record the trade.
    const trade = buildTradeObject(match, currentBlockHeight, flipData);
    await recordTrade(trade, currentBlockHeight);

    // 8. Update volume data and liquidity rewards.
    await updateVolumeAndRewards(match, currentBlockHeight);

    // Save the updated margin map after processing the match.
    await MarginMap.saveMarginMap(currentBlockHeight);
  }
  // Return something if needed.
  return;
}

// 1. Validate the match and load up-to-date state (positions, collateral, etc.)
async validateMatch(match) {
  // Check for self-trade
  if (match.buyOrder.buyerAddress === match.sellOrder.sellerAddress) {
    throw new Error(`Self-trade detected for ${match.buyOrder.buyerAddress}`);
  }
  // Load the margin map for this contract
  const marginMap = await MarginMap.loadMarginMap(match.sellOrder.contractId);
  match.buyerPosition = await marginMap.getPositionForAddress(match.buyOrder.buyerAddress, match.buyOrder.contractId);
  match.sellerPosition = await marginMap.getPositionForAddress(match.sellOrder.sellerAddress, match.buyOrder.contractId);
  if (!match.buyerPosition.address) match.buyerPosition.address = match.buyOrder.buyerAddress;
  if (!match.sellerPosition.address) match.sellerPosition.address = match.sellOrder.sellerAddress;
  
  // Attach collateral and notional info
  match.collateralPropertyId = await ContractRegistry.getCollateralId(match.buyOrder.contractId);
  const blob = await ContractRegistry.getNotionalValue(match.sellOrder.contractId, match.tradePrice);
  match.notionalValue = blob.notionalValue;
  match.perContractNotional = blob.notionalPerContract;
  // Also fetch tally (reserve/available) for each side if needed later.
  match.reserveA = await TallyMap.getTally(match.sellOrder.sellerAddress, match.collateralPropertyId);
  match.reserveB = await TallyMap.getTally(match.buyOrder.buyerAddress, match.collateralPropertyId);
  
  // Determine if contract is inverse
  match.inverse = await ContractRegistry.isInverse(match.sellOrder.contractId);
  
  return match;
}

// 2. Calculate fees for the match and update fee caches
async calculateFees(match, channel) {
  // (Assume you have a calculateFee function available.)
  const buyerFee = calculateFee(
    match.buyOrder.amount,
    match.sellOrder.maker,
    match.buyOrder.maker,
    match.inverse,
    true,
    match.tradePrice,
    match.notionalValue,
    channel
  );
  const sellerFee = calculateFee(
    match.sellOrder.amount,
    match.sellOrder.maker,
    match.buyOrder.maker,
    match.inverse,
    false,
    match.tradePrice,
    match.notionalValue,
    channel
  );
  await TallyMap.updateFeeCache(match.collateralPropertyId, buyerFee, match.buyOrder.contractId);
  await TallyMap.updateFeeCache(match.collateralPropertyId, sellerFee, match.buyOrder.contractId);
  
  // Return fee info object. (You can add more properties as needed.)
  return { buyerFee, sellerFee, buyFeeFromMargin: false, sellFeeFromMargin: false };
}

// 3. Handle flip logic: check if buyer/seller are “flipping” their positions and adjust margin accordingly.
async handleFlipLogic(match, feeInfo, currentBlockHeight) {
  const flipData = { flipLong: 0, flipShort: 0, buyerFullyClosed: false, sellerFullyClosed: false };
  const initialMarginPerContract = await ContractRegistry.getInitialMargin(match.buyOrder.contractId, match.tradePrice);
  
  // Buyer flip: if buyer's order amount exceeds the absolute value of a negative (short) position.
  const isBuyerFlipping = (match.buyOrder.amount > Math.abs(match.buyerPosition.contracts)) && (match.buyerPosition.contracts < 0);
  // Seller flip: if seller's order amount exceeds a positive (long) position.
  const isSellerFlipping = (match.sellOrder.amount > match.sellerPosition.contracts) && (match.sellerPosition.contracts > 0);
  
  if (isBuyerFlipping) {
    const closedContracts = Math.abs(match.buyerPosition.contracts);
    flipData.flipLong = match.buyOrder.amount - closedContracts;
    // Release margin for closed contracts.
    const marginToRelease = new BigNumber(initialMarginPerContract).times(closedContracts).decimalPlaces(8).toNumber();
    await TallyMap.updateBalance(
      match.buyOrder.buyerAddress,
      match.collateralPropertyId,
      marginToRelease,
      -marginToRelease,
      0,
      0,
      'contractMarginRelease',
      currentBlockHeight
    );
    flipData.buyerFullyClosed = true;
  }
  
  if (isSellerFlipping) {
    const closedContracts = Math.abs(match.sellerPosition.contracts);
    flipData.flipShort = match.sellOrder.amount - closedContracts;
    const marginToRelease = new BigNumber(initialMarginPerContract).times(closedContracts).decimalPlaces(8).toNumber();
    await TallyMap.updateBalance(
      match.sellOrder.sellerAddress,
      match.collateralPropertyId,
      marginToRelease,
      -marginToRelease,
      0,
      0,
      'contractMarginRelease',
      currentBlockHeight
    );
    flipData.sellerFullyClosed = true;
  }
  
  return flipData;
}

// 4. Move collateral for non-reducing orders (for buyer and seller).
async moveCollateral(match, feeInfo, channel, currentBlockHeight) {
  // Only move collateral if the order is not marked as liquidation and not reducing.
  if (!match.buyOrder.liq && !match.buyerReducing) {
    match.buyerPosition = await ContractRegistry.moveCollateralToMargin(
      match.buyOrder.buyerAddress,
      match.buyOrder.contractId,
      match.buyOrder.amount,
      match.tradePrice,
      match.buyOrder.price,
      false,
      match.buyOrder.marginUsed,
      channel,
      channel ? match.channelAddress : null,
      currentBlockHeight,
      feeInfo,
      match.buyOrder.maker
    );
  }
  if (!match.sellOrder.liq && !match.sellerReducing) {
    match.sellerPosition = await ContractRegistry.moveCollateralToMargin(
      match.sellOrder.sellerAddress,
      match.sellOrder.contractId,
      match.sellOrder.amount,
      match.tradePrice,
      match.sellOrder.price,
      true,
      match.sellOrder.marginUsed,
      channel,
      channel ? match.channelAddress : null,
      currentBlockHeight,
      feeInfo,
      match.buyOrder.maker
    );
  }
  return match;
}

// 5. Update contract balances using the match.
async updateContractBalances(match, channel, flipData) {
  const marginMap = await MarginMap.loadMarginMap(match.buyOrder.contractId);
  // Assume updateContractBalancesWithMatch is defined on marginMap.
  const positions = await marginMap.updateContractBalancesWithMatch(match, channel, 
    (match.buyerReducing || match.sellerReducing), 
    (flipData.flipLong > 0 || flipData.flipShort > 0)
  );
  return positions; // e.g., { bp: updated buyerPosition, sp: updated sellerPosition }
}

// 6. Realize PnL and settle for reducing trades.
async realizePnLAndSettle(match, currentBlockHeight, flipData) {
  const marginMap = await MarginMap.loadMarginMap(match.buyOrder.contractId);
  const lastMark = await ContractRegistry.getPriceAtBlock(match.buyOrder.contractId, currentBlockHeight) || match.tradePrice;
  // For buyer
  if ((match.buyerReducing || match.buyerFlipping) && !match.buyOrder.liq) {
    let closedContracts = match.buyOrder.amount;
    if (match.buyerFlipping) {
      closedContracts -= flipData.flipLong;
    }
    const avgEntry = match.buyerPosition.avgPrice;
    match.buyerPosition = await marginMap.realizePnl(
      match.buyOrder.buyerAddress,
      closedContracts,
      match.tradePrice,
      avgEntry,
      match.inverse,
      match.perContractNotional,
      match.buyerPosition,
      true,
      match.buyOrder.contractId
    );
    const settlementPNL = await marginMap.settlePNL(
      match.buyOrder.buyerAddress,
      closedContracts,
      match.tradePrice,
      lastMark,
      match.buyOrder.contractId,
      currentBlockHeight
    );
    await TallyMap.updateBalance(
      match.buyOrder.buyerAddress,
      match.collateralPropertyId,
      settlementPNL,
      0,
      0,
      0,
      'contractTradeSettlement',
      currentBlockHeight
    );
  }
  // For seller
  if ((match.sellerReducing || match.sellerFlipping) && !match.sellOrder.liq) {
    let closedContracts = match.sellOrder.amount;
    if (match.sellerFlipping) {
      closedContracts -= flipData.flipShort;
    }
    const avgEntry = match.sellerPosition.avgPrice;
    match.sellerPosition = await marginMap.realizePnl(
      match.sellOrder.sellerAddress,
      closedContracts,
      match.tradePrice,
      avgEntry,
      match.inverse,
      match.perContractNotional,
      match.sellerPosition,
      false,
      match.sellOrder.contractId
    );
    const settlementPNL = await marginMap.settlePNL(
      match.sellOrder.sellerAddress,
      closedContracts,
      match.tradePrice,
      lastMark,
      match.sellOrder.contractId,
      currentBlockHeight
    );
    await TallyMap.updateBalance(
      match.sellOrder.sellerAddress,
      match.collateralPropertyId,
      settlementPNL,
      0,
      0,
      0,
      'contractTradeSettlement',
      currentBlockHeight
    );
  }
  return match;
}

// 7. Build a trade object from the match data.
buildTradeObject(match, currentBlockHeight, flipData) {
  return {
    contractId: match.sellOrder.contractId,
    amount: match.sellOrder.amount,
    price: match.tradePrice,
    buyerAddress: match.buyOrder.buyerAddress,
    sellerAddress: match.sellOrder.sellerAddress,
    sellerTx: match.sellOrder.sellerTx,
    buyerTx: match.buyOrder.buyerTx,
    buyerClose: match.buyOrder.amount - (flipData.flipLong || 0),
    sellerClose: match.sellOrder.amount - (flipData.flipShort || 0),
    block: currentBlockHeight,
    buyerFullClose: (match.buyerPosition.contracts === match.buyOrder.amount),
    sellerFullClose: (match.sellerPosition.contracts === match.sellOrder.amount),
    flipLong: flipData.flipLong,
    flipShort: flipData.flipShort,
    channel: match.channel,
    liquidation: Boolean(match.sellOrder.liq || match.buyOrder.liq)
  };
}

// 8. Record the trade in trade history.
async recordTrade(trade, currentBlockHeight) {
  const tradeHistoryManager = new TradeHistory();
  await tradeHistoryManager.recordContractTrade(trade, currentBlockHeight);
}

// 9. Update volume data and liquidity rewards.
async updateVolumeAndRewards(match, currentBlockHeight) {
  // Calculate volume (UTXOEquivalentVolume) and update volume data.
  const UTXOEquivalentVolume = await VolumeIndex.getUTXOEquivalentVolume(
    match.sellOrder.contractId,
    match.sellOrder.amount,
    'contract',
    match.collateralPropertyId,
    match.perContractNotional,
    match.inverse,
    match.tradePrice
  );
  if (match.channel === false) {
    await VolumeIndex.saveVolumeDataById(
      match.sellOrder.contractId,
      match.sellOrder.amount,
      UTXOEquivalentVolume,
      match.tradePrice,
      currentBlockHeight,
      'onChainContract'
    );
  } else {
    await VolumeIndex.saveVolumeDataById(
      match.sellOrder.contractId,
      match.sellOrder.amount,
      UTXOEquivalentVolume,
      match.tradePrice,
      currentBlockHeight,
      'channelContract'
    );
  }
  // Evaluate and update liquidity rewards if applicable.
  const qualifiesBasicLiqReward = await evaluateBasicLiquidityReward(match, match.channel, true);
  const qualifiesEnhancedLiqReward = await evaluateEnhancedLiquidityReward(match, match.channel);
  if (qualifiesBasicLiqReward) {
    const notionalTokens = match.notionalValue * match.sellOrder.amount;
    const liqRewardBaseline = await VolumeIndex.baselineLiquidityReward(notionalTokens, 0.000025, match.collateralPropertyId);
    await TallyMap.updateBalance(match.sellOrder.sellerAddress, 3, liqRewardBaseline, 0, 0, 0, 'baselineLiquidityReward');
    await TallyMap.updateBalance(match.buyOrder.buyerAddress, 3, liqRewardBaseline, 0, 0, 0, 'baselineLiquidityReward');
  }
  if (qualifiesEnhancedLiqReward) {
    const notionalTokens = match.notionalValue * match.sellOrder.amount;
    const liqRewardBaseline = await VolumeIndex.calculateLiquidityReward(notionalTokens);
    await TallyMap.updateBalance(match.sellOrder.sellerAddress, 3, liqRewardBaseline, 0, 0, 0, 'enhancedLiquidityReward');
    await TallyMap.updateBalance(match.buyOrder.buyerAddress, 3, liqRewardBaseline, 0, 0, 0, 'enhancedLiquidityReward');
  }
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
            console.log('about to call cancelOrdersByCriteria in cancelAllContractOrders '+fromAddress, key, criteria)
            const cancelledOrders = await this.cancelOrdersByCriteria(fromAddress, key, criteria);
            const collateralPropertyId = await ContractRegistry.getCollateralId(offeredPropertyId);
            console.log('returning from reserve '+cancelledOrders.returnFromReserve)
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

    async cancelAllOrdersForAddress(fromAddress, key, block, collateralPropertyId) {
        const TallyMap = require('./tally.js');
        const ContractRegistry = require('./contractRegistry.js');
        
        console.log(`\n🛑 Cancelling all contract ${key} orders for ${fromAddress}`);

        // Load the correct order book
        //let orderBook = this.orderBooks[key]; // Correctly get the order book
        //if (!orderBook) {
            //console.log('cant find locally loading book from db');
            let orderBook = await this.loadOrderBook(key, fromAddress);
        //}

        // Ensure `buy` and `sell` arrays exist but avoid overwriting
        if (!Array.isArray(orderBook.buy)) orderBook.buy = [];
        if (!Array.isArray(orderBook.sell)) orderBook.sell = [];

        let cancelledOrders = [];
        let returnFromReserve = 0;

        // Cancel Buy Orders
        orderBook.buy = orderBook.buy.filter(order => {
            console.log('in buy cancel filter '+order.sender+' '+fromAddress)
            if (order.sender === fromAddress) {
                cancelledOrders.push(order);
                returnFromReserve += order.initMargin || 0;
                return false; // Remove this order
            }
            return true; // Keep order
        });

        // Cancel Sell Orders
        orderBook.sell = orderBook.sell.filter(order => {
        console.log('in sell cancel filter '+order.sender+' '+fromAddress)
            if (order.sender === fromAddress) {
                cancelledOrders.push(order);
                returnFromReserve += order.initMargin || 0;
                return false; // Remove this order
            }
            return true; // Keep order
        });

        console.log(`✅ Cancelled ${cancelledOrders.length} orders for ${fromAddress}. Returning ${returnFromReserve} to reserve.`);
        console.log(JSON.stringify(cancelledOrders))
        // Save the updated order book
        this.orderBooks[key] = orderBook; // Ensure it overwrites, not merges
        console.log('about to save orderbook '+JSON.stringify(orderBook))
        await this.saveOrderBook(orderBook, key);

        // Process reserve refunds
        if (returnFromReserve > 0) {
            await TallyMap.updateBalance(fromAddress, collateralPropertyId, returnFromReserve, -returnFromReserve, 0, 0, 'contractCancel', block);
        }

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
