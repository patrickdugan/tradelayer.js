const BigNumber = require('bignumber.js')
const dbInstance = require('./db.js'); // Import your database instance


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

        async loadOrCreateOrderBook() {
            const orderBooksDB = dbInstance.getDatabase('orderBooks');
            const orderBookData = await orderBooksDB.findOneAsync({ _id: this.orderBookKey });
            
            if (orderBookData) {
                this.orderBooks[this.orderBookKey] = JSON.parse(orderBookData.value);
                console.log('loading the orderbook for ' +this.orderBookKey + ' in the form of ' + JSON.stringify(orderBookData))
            } else {
                // If no data found, create a new order book
                this.orderBooks[this.orderBookKey] = { buy: [], sell: [] };
                console.log('loading fresh orderbook '+this.orderBooks[this.orderBookKey])

                await this.saveOrderBook(this.orderBookKey);
            }
        }

    // Function to divide two numbers with an option to round up or down to the nearest Satoshi
    divideAndRound(number1, number2, roundUp = false) {
        const result = new BigNumber(number1).dividedBy(new BigNumber(number2));
        return roundUp
            ? result.decimalPlaces(8, BigNumber.ROUND_UP).toString()
            : result.decimalPlaces(8, BigNumber.ROUND_DOWN).toString();
    }

    async saveOrderBook(pair) {
        // Save order book to your database
        console.log('saving pair '+JSON.stringify(pair)/*, + ' '+ JSON.stringify(this.orderbooks[pair])*/)
        const orderBooksDB = dbInstance.getDatabase('orderBooks');
        await orderBooksDB.updateAsync(
          { _id: pair },
          { _id: pair, value: JSON.stringify(this.orderBooks[pair]) },
          { upsert: true }
        );
      }


    // Adds a token order to the order book
    async addTokenOrder(order, blockHeight, txid) {
        const TallyMap = require('./tally.js'); //lazy load so we can move available to reserved for this order
        await TallyMap.updateBalance(order.senderAddress, order.offeredPropertyId, -order.amountOffered, order.amountOffered, 0, 0, false,false,false,txid);
        
        // Determine the correct orderbook key
        const normalizedOrderBookKey = this.normalizeOrderBookKey(order.offeredPropertyId, order.desiredPropertyId);
        console.log('Normalized Order Book Key:', normalizedOrderBookKey);

        // Create an instance of Orderbook for the pair and load its data
        const orderbook = new Orderbook(normalizedOrderBookKey);
        await orderbook.loadOrCreateOrderBook();

        // Calculate the price for the order and round to the nearest tick interval
        const calculatedPrice = this.calculatePrice(order.amountOffered, order.amountExpected);
        console.log('Calculated Price:', calculatedPrice);
        order.price = calculatedPrice; // Append the calculated price to the order object

        // Determine if the order is a sell order
        const isSellOrder = order.offeredPropertyId < order.desiredPropertyId;

        // Add the order to the orderbook
        const orderConfirmation = await orderbook.insertOrder(order, normalizedOrderBookKey, isSellOrder);
        console.log('Order Insertion Confirmation:', orderConfirmation);

        // Match orders in the orderbook
        const matchResult = await orderbook.matchTokenOrders(normalizedOrderBookKey);
        if (matchResult.matches && matchResult.matches.length > 0) {
            console.log('Match Result:', matchResult);
            await this.processTokenMatches(matchResult.matches, blockHeight, txid);
        }else{console.log('No Matches for ' +txid)}
        console.log('Normalized Order Book Key before saving:', normalizedOrderBookKey);

        // Save the updated orderbook back to the database
        await orderbook.saveOrderBook(normalizedOrderBookKey);

        return matchResult;
    }


    normalizeOrderBookKey(propertyId1, propertyId2) {
        // Ensure lower property ID is first in the key
        return propertyId1 < propertyId2 ? `${propertyId1}-${propertyId2}` : `${propertyId2}-${propertyId1}`;
    }

    addContractOrder({ contractId, amount, price, block, sell }) {
        const ContractRegistry = require('./contractRegistry.js')
        await ContractRegistry.moveCollateralToMargin() //first we line up the capital

        // Create a contract order object with the sell parameter
        const contractOrder = { contractId, amount, price, block, sell };

        // The orderBookKey is based on the contractId since it's a derivative contract
        const orderBookKey = `contract-${contractId}`;

        // Insert the contract order into the order book
        await this.insertOrder(contractOrder, orderBookKey, sell);

        // Match orders in the derivative contract order book
        var matchResult = await this.matchContractOrders(orderBookKey);

        await this.processContractMatches()

        await orderbook.saveOrderBook(normalizedOrderBookKey);
        return matchResult

    }

    async insertOrder(order, orderBookKey, isSellOrder) {
        if (!this.orderBooks[orderBookKey]) {
            this.orderBooks[orderBookKey] = { buy: [], sell: [] };
        }

        const side = isSellOrder ? 'sell' : 'buy';
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
        console.log('price ratio '+priceRatio)
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

                // Check for price match
                if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {


                    // Ensure that sellOrder.amountOffered and buyOrder.amountExpected are BigNumber objects
                    let sellOrderAmountOffered = new BigNumber(sellOrder.amountOffered);
                    let buyOrderAmountExpected = new BigNumber(buyOrder.amountExpected);

                    // Use BigNumber methods to perform calculations
                    let amountOfTokenA = BigNumber.min(sellOrderAmountOffered, buyOrderAmountExpected.times(sellOrder.price));
                    let amountOfTokenB = amountOfTokenA.div(sellOrder.price);

                    // Update orders after the match
                    sellOrder.amountOffered = BigNumber(sellOrder.amountOffered).minus(amountOfTokenA).toNumber();
                    buyOrder.amountExpected = BigNumber(buyOrder.amountExpected).minus(amountOfTokenB).toNumber();

                    // Add to matches
                    matches.push({ sellOrder, buyOrder, amountOfTokenA: amountOfTokenA.toNumber(), amountOfTokenB: amountOfTokenB.toNumber() });
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
            console.log('No valid matches to process');
            return;
        }

        for (const match of matches) {
            if (!match.sellOrder || !match.buyOrder) {
                console.error('Invalid match object:', match);
                continue;
            }

            const sellOrderAddress = match.sellOrder.senderAddress;
            const buyOrderAddress = match.buyOrder.senderAddress;
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

            if(txid=="5049a4ac9c8dd3f19278b780135eeb7900b0771e6b9829044900f9fb656b976a"){
                console.log('looking into the problematic tx' +JSON.stringify(match)+ 'times '+match.sellOrder.blockTime + ' '+match.buyOrder.blockTime)
            }
            console.log('amountTo Trade A and B '+ amountToTradeA + ' '+ amountToTradeB + ' '+ 'match values '+ match.amountOfTokenA + ' '+ match.amountOfTokenB)
            // Determine order roles and calculate fees
            if (match.sellOrder.blockTime < match.buyOrder.blockTime) {
                match.sellOrder.orderRole = 'maker';
                match.buyOrder.orderRole = 'taker';
                takerFee = amountToTradeB.times(0.0002);
                console.log('taker fee '+takerFee)
                makerRebate = takerFee.div(2);
                console.log('maker fee '+makerRebate)
                takerFee = takerFee.div(2) //accounting for the half of the taker fee that goes to the maker
                console.log(' actual taker fee '+takerFee)
                await TallyMap.updateFeeCache(buyOrderPropertyId, takerFee.toNumber());
                console.log('about to calculate this supposed NaN '+match.amountOfTokenA+' '+new BigNumber(match.amountOfTokenA) + ' '+new BigNumber(match.amountOfTokenA).plus(makerRebate)+ ' '+ new BigNumber(match.amountToTradeA).plus(makerRebate).toNumber)
                sellOrderAmountChange = new BigNumber(match.amountOfTokenA).plus(makerRebate).toNumber();
                console.log('sell order amount change ' +sellOrderAmountChange)
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
                var takerFeeB = amountToTradeB.time(0.0001);
                await TallyMap.updateFeeCache(buyOrderPropertyId, takerFeeA.toNumber());
                await TallyMap.updateFeeCache(sellOrderPropertyId, takerFeeB.toNumber());
                sellOrderAmountChange = new BigNumber(match.amountOfTokenA).minus(takerFeeA).toNumber();
                buyOrderAmountChange = new BigNumber(match.amountOfTokenB).minus(takerFeeB).toNumber();
            }

            // Debit the traded amount from the seller's reserve 
            await TallyMap.updateBalance(
                match.sellOrder.senderAddress,
                match.sellOrder.offeredPropertyId,
                0,  // Credit traded amount of Token B to available
                -match.amountOfTokenA, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            );
            //and credit the opposite consideration to available

            await TallyMap.updateBalance(
                match.sellOrder.senderAddress,
                match.sellOrder.desiredPropertyId,
                match.amountOfTokenB,  // Credit traded amount of Token B to available
                0, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            );

            // Update balance for the buyer
            // Debit the traded amount from the buyer's reserve and credit it to available
            await TallyMap.updateBalance(
                match.buyOrder.senderAddress,
                match.buyOrder.offeredPropertyId,
                0,  // Credit traded amount of Token B to available
                -match.amountOfTokenB, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            );

            await TallyMap.updateBalance(
                match.buyOrder.senderAddress,
                match.buyOrder.desiredPropertyId,
                match.amountOfTokenA,  // Credit traded amount of Token B to available
                0, // Debit the same amount from reserve
                0, 0, true, false, false, txid
            );

        }
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

            // Check for price match
            if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                // Calculate the amount to be traded
                let tradeAmount = BigNumber.min(sellOrder.amount, buyOrder.amount);
                
                // Update orders after the match
                sellOrder.amount = BigNumber(sellOrder.amount).minus(tradeAmount).toNumber();
                buyOrder.amount = BigNumber(buyOrder.amount).minus(tradeAmount).toNumber();

                // Add match to the list
                matches.push({ 
                    sellOrder: { ...sellOrder, amount: tradeAmount.toNumber() }, 
                    buyOrder: { ...buyOrder, amount: tradeAmount.toNumber() } 
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


    processContractMatches(matches) {
        matches.forEach(match => {
            // Logic for identifying and updating the marginMap for contracts
            // You can go to negative balances for contracts, so the logic here
            // will need to be different than for tokens.

            // Example logic (you'll need to replace this with your actual logic):
            const contract = this.marginMap.get(match.contractId);
            if (match.sell) {
                // Update seller's margin balance
                contract.sellerMargin = contract.sellerMargin.minus(match.amountToTrade);
                // Update buyer's balance (can go negative)
                contract.buyerMargin = contract.buyerMargin.plus(match.amountToTrade.minus(match.takerFee));
            } else {
                // Update buyer's margin balance
                contract.buyerMargin = contract.buyerMargin.minus(match.amountToTrade);
                // Update seller's balance (can go negative)
                contract.sellerMargin = contract.sellerMargin.plus(match.amountToTrade.plus(match.makerRebate));
            }

            // Save the updated contract margins back to the marginMap
            this.marginMap.set(match.contractId, contract);
        });
    }

    async processContractMatches(matches, currentBlockHeight) {
        for (const match of matches) {
            try {
                // Load the margin map for the given series ID and block height
                const marginMap = await MarginMap.loadMarginMap(match.contractSeriesId, currentBlockHeight);

                // Get the existing position sizes for buyer and seller
                const buyerPositionSize = marginMap.getPositionSize(match.buyerAddress);
                const sellerPositionSize = marginMap.getPositionSize(match.sellerAddress);

                // Update contract balances for the buyer and seller
                marginMap.updateContractBalances(match.buyerAddress, match.amount, match.price, true);
                marginMap.updateContractBalances(match.sellerAddress, match.amount, match.price, false);

                // Determine if the trade reduces the position size for buyer or seller
                const isBuyerReducingPosition = buyerPositionSize > 0 && match.amount < 0;
                const isSellerReducingPosition = sellerPositionSize < 0 && match.amount > 0;

                // Realize PnL if the trade reduces the position size
                let buyerPnl = 0, sellerPnl = 0;
                if (isBuyerReducingPosition) {
                    buyerPnl = marginMap.realizePnl(match.buyerAddress, match.amount, match.price, match.buyerAvgPrice);
                }
                if (isSellerReducingPosition) {
                    sellerPnl = marginMap.realizePnl(match.sellerAddress, -match.amount, match.price, match.sellerAvgPrice);
                }

                // Update margin based on the new positions
                marginMap.updateMargin(match.buyerAddress, match.amount, match.price);
                marginMap.updateMargin(match.sellerAddress, -match.amount, match.price);

                // Save the updated margin map
                await marginMap.saveMarginMap(currentBlockHeight);

                // Optionally handle the PnL if needed, e.g., logging or further processing
                // ...

            } catch (error) {
                console.error(`Error processing contract match ${match.id}:`, error);
                // Handle error, potentially rolling back any partial updates or retrying
            }
        }
    }
}

module.exports = Orderbook;
