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
                console.log(JSON.stringify(orderBookData.value))
            } else {
                // If no data found, create a new order book
                this.orderBooks[this.orderBookKey] = { buy: [], sell: [] };
                console.log(this.orderBooks[this.orderBookKey])

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
    async addTokenOrder(order){
        const price = this.calculatePrice(order.amountOffered, order.amountExpected);

        const orderBookKey = `${order.offeredPropertyId}-${order.desiredPropertyId}`;
        console.log('inserting orders '+ JSON.stringify(order)+ ' of orderBookKey '+orderBookKey)
        const orderConfirmation = await this.insertOrder(order, orderBookKey);
        console.log('matching order '+orderConfirmation)
        const matchResult = await this.matchOrders(orderBookKey);
        console.log('match result ' +matchResult)
        return matchResult
    }

    addContractOrder({ contractId, amount, price, time, sell }) {
        // Create a contract order object with the sell parameter
        const contractOrder = { contractId, amount, price, time, sell };

        // The orderBookKey is based on the contractId since it's a derivative contract
        const orderBookKey = `contract-${contractId}`;

        // Insert the contract order into the order book
        this.insertOrder(contractOrder, orderBookKey, true);

        // Match orders in the derivative contract order book
        this.matchOrders(orderBookKey);
    }

    async insertOrder(order, orderBookKey, isContractOrder = false) {
        // If order book does not exist, create it
        if (!this.orderBooks[orderBookKey]) {
            this.orderBooks[orderBookKey] = { buy: [], sell: [] };
        }
        console.log('ze book '+JSON.stringify(this.orderBooks[orderBookKey]))
        // Determine if it's a buy or sell order based on the property IDs
        let side = {} 
        if (isContractOrder == false) {
            side = order.propertyIdNumber < order.propertyIdNumberDesired ? 'buy' : 'sell';
        } else if (isContractOrder == true && sell == true) {
            side = 'sell';
        } else if (isContractOrder == true && sell == false) {
            side = 'buy'
        }
        console.log(side)
        
        // Insert the order into the correct side of the book
        const bookSide = this.orderBooks[orderBookKey][side];
        console.log('bookSide '+bookSide)
        const index = bookSide.findIndex((o) => o.time > order.time);
        console.log(index)
        if (index === -1) {
            bookSide.push(order);
        } else {
            bookSide.splice(index, 0, order);
        }
     
        // Save the updated order book
        await this.saveOrderBook(orderBookKey);

        return 'updated book ' +JSON.stringify(this.orderBooks)
    }

    calculatePrice(amountOffered, amountExpected) {
        const priceRatio = new BigNumber(amountOffered).dividedBy(amountExpected);
        console.log('price ratio '+priceRatio)
        return priceRatio.decimalPlaces(8, BigNumber.ROUND_HALF_UP);
    }

    async matchOrders(orderBookKey, isContract = false) {
        const orderBook = this.orderBooks[orderBookKey];
        if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
            return 'first order in the book'; // Nothing to match
        }

        const matches = [];

        // Sort buy orders from highest to lowest price and sell orders from lowest to highest price
        orderBook.buy.sort((a, b) => b.price.comparedTo(a.price) || a.time - b.time); // Highest price and oldest first
        orderBook.sell.sort((a, b) => a.price.comparedTo(b.price) || a.time - b.time); // Lowest price and oldest first

        // While there is still potential for matches
        while (orderBook.sell.length > 0 && orderBook.buy.length > 0 &&
               orderBook.sell[0].price.lte(orderBook.buy[0].price)) {

            let sellOrder = orderBook.sell[0];
            let buyOrder = orderBook.buy[0];

            // Determine the amount to trade which is the minimum of the two orders
            const amountToTrade = BigNumber.minimum(sellOrder.amountOffered, buyOrder.amountExpected);

            // Update orders
            sellOrder.amountOffered = sellOrder.amountOffered.minus(amountToTrade);
            buyOrder.amountExpected = buyOrder.amountExpected.minus(amountToTrade);

            // Determine order role (maker, taker, split)
            let orderRole = '';
            if (sellOrder.time < buyOrder.time) {
                orderRole = 'maker';
            } else if (sellOrder.time > buyOrder.time) {
                orderRole = 'taker';
            } else {
                orderRole = 'split';
            }

            // Calculate fees based on the role
            let takerFee, makerRebate;
            if (isContract) {
                takerFee = amountToTrade.times(0.0001);
                makerRebate = orderRole === 'split' ? takerFee.div(2) : takerFee;
            } else {
                takerFee = amountToTrade.times(0.0002);
                makerRebate = orderRole === 'split' ? takerFee.div(2) : (orderRole === 'maker' ? takerFee : new BigNumber(0));
            }

            // Adjust balances based on fees
            if (orderRole === 'maker' || orderRole === 'split') {
                buyOrder.amountExpected = buyOrder.amountExpected.minus(takerFee);
                sellOrder.amountOffered = sellOrder.amountOffered.plus(makerRebate);
            } else {
                // In case of taker, the whole fee is deducted from the buyer
                buyOrder.amountExpected = buyOrder.amountExpected.minus(takerFee);
            }

            // If an order is completely filled, remove it from the order book
            if (sellOrder.amountOffered.isZero()) {
                orderBook.sell.shift();
            }
            if (buyOrder.amountExpected.isZero()) {
                orderBook.buy.shift();
            }

            const matchedOrderDetails = {
                sellOrderId: sellOrder.id,
                buyOrderId: buyOrder.id,
                amountToTrade: amountToTrade.toString(),
                price: sellOrder.price.toString(),
                takerFee: takerFee.toString(),
                makerRebate: makerRebate.toString(),
                orderRole: orderRole
            };

            matches.push(matchedOrderDetails);

            // Partial matches remain in the order book (already updated)
        }

            // Check if there were any matches
            if (matches.length === 0) {
                return 'No matches found'; // No matches occurred
            }

        const matchResults = {
            orderBook: this.orderBooks[orderBookKey],
            matches
        };

        if (isContract) {
            this.processContractMatches(matchResults.matches);
        } else {
            this.processTokenMatches(matchResults.matches);
        }

        this.save(orderBookKey);

        // Return the updated order book and the matches
        return {
            orderBook: this.orderBooks[orderBookKey],
            matches
        };
    }


    processTokenMatches(matches) {
        matches.forEach(match => {
            const sellOrder = this.getAddressBalances(match.sellOrderId);
            const buyOrder = this.getAddressBalances(match.buyOrderId);

            // Debit the reserve balances from the seller and buyer
            sellOrder.reserveAmount = sellOrder.reserveAmount.minus(match.amountToTrade);
            buyOrder.reserveAmount = buyOrder.reserveAmount.minus(match.amountToTrade);

            // Credit the available balances to the buyer and seller
            sellOrder.available = sellOrder.available.plus(match.amountToTrade);
            buyOrder.available = buyOrder.available.plus(match.amountToTrade);

            // Apply fees and rebates
            buyOrder.available = buyOrder.available.minus(match.takerFee);
            sellOrder.available = sellOrder.available.plus(match.makerRebate);

            // Save the updated balances back to the TallyMap
            this.updateBalance(match.sellOrderId, sellOrder);
            this.updateBalance(match.buyOrderId, buyOrder);
        });
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

                // Update contract balances for the buyer and seller
                marginMap.updateContractBalances(match.buyerAddress, match.amount, match.price, true);
                marginMap.updateContractBalances(match.sellerAddress, match.amount, match.price, false);
                marginMap.updateMargin(match.buyerAddress, match.amount, match.price);
                marginMap.updateMargin(match.sellerAddress, -match.amount, match.price);

                // Realize PnL for the buyer and seller
                const buyerPnl = marginMap.realizePnl(match.buyerAddress, match.amount, match.price, match.buyerAvgPrice);
                const sellerPnl = marginMap.realizePnl(match.sellerAddress, -match.amount, match.price, match.sellerAvgPrice);

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
