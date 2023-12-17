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
    async addTokenOrder(order) {
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
        const matchResult = await orderbook.matchOrders(normalizedOrderBookKey);
        console.log('Match Result:', matchResult);
        console.log('Normalized Order Book Key before saving:', normalizedOrderBookKey);

        // Save the updated orderbook back to the database
        await orderbook.saveOrderBook(normalizedOrderBookKey);

        return matchResult;
    }


    normalizeOrderBookKey(propertyId1, propertyId2) {
        // Ensure lower property ID is first in the key
        return propertyId1 < propertyId2 ? `${propertyId1}-${propertyId2}` : `${propertyId2}-${propertyId1}`;
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
        return priceRatio.decimalPlaces(8, BigNumber.ROUND_HALF_UP);
    }

    async matchOrders(orderBookKey) {
            const orderBook = this.orderBooks[orderBookKey];
            if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
                return 'No matches found due to empty book'; // No orders to match
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
                    // Determine the amount to trade (minimum of the two orders)
                    let amountToTrade = BigNumber.min(sellOrder.amountOffered, buyOrder.amountExpected);

                    // Update orders after the match
                    sellOrder.amountOffered = BigNumber(sellOrder.amountOffered).minus(amountToTrade);
                    buyOrder.amountExpected = BigNumber(buyOrder.amountExpected).minus(amountToTrade);

                    // Add to matches
                    matches.push({ sellOrder, buyOrder, amountToTrade: amountToTrade.toString() });
                    matchOccurred = true;

                    // Remove filled orders from the order book
                    if (sellOrder.amountOffered.isZero()) orderBook.sell.shift();
                    if (buyOrder.amountExpected.isZero()) orderBook.buy.shift();
                } else {
                    break; // No more matches possible
                }
            }

            // Return matches or indicate no matches
            if (matchOccurred) {
                return { orderBook: this.orderBooks[orderBookKey], matches };
            } else {
                return 'No matches found';
            }
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
