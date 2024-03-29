const BigNumber = require('bignumber.js')
const { dbFactory } = require('./db.js')
const { tallyMap } = require('./tally.js')
const MarginMap = require('./marginMap.js')

class Orderbook {
    constructor(tickSize = new BigNumber('0.00000001')) {
        this.tickSize = tickSize;
        //this.orderBookKey = orderBookKey; // Unique identifier for each orderbook (contractId or propertyId pair)
        this.orderBooks = {};
    }

    async load(key) {
        const data = await dbFactory.getDatabase('orderBooks').findOneAsync({ _id: key })
        if (data?.value) {
            this.orderBooks[key] = JSON.parse(data.value)
            //console.log('loading the orderbook for ' + key + ' in the form of ' + JSON.stringify(orderBookData))
        } else {
            // If no data found, create a new order book
            this.orderBooks[key] = { buy: [], sell: [] };
            console.log('loading fresh orderbook ' + this.orderBooks[key])

        }
        await this.save(key)
        return this.orderBooks[key]
    }

    async save(key) {
        //console.log('saving pair ' + JSON.stringify(key) /*, + ' ' + JSON.stringify(this.orderbooks[key])*/)
        await dbFactory.getDatabase('orderBooks').updateAsync(
            { _id: key },
            { _id: key, value: JSON.stringify(this.orderBooks[key]) },
            { upsert: true }
        )
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
        await this.saveTrade(tradeRecord)
    }

    // Record a contract trade with specific key identifiers
    async recordContractTrade(trade, blockHeight, txid) {
        const tradeRecordKey = `contract-${trade.contractId}`;
        const tradeRecord = {
            key: tradeRecordKey,
            type: 'contract',
            trade,
            blockHeight,
            txid
        };
        console.log('saving contract trade ' + JSON.stringify(trade))
        await this.saveTrade(tradeRecord)
    }

    async saveTrade(tradeRecord) {
        const tradeDB = dbFactory.getDatabase('tradeHistory')

        // Use the key provided in the trade record for storage
        const tradeId = `${tradeRecord.key}-${tradeRecord.txid}-${tradeRecord.blockHeight}`;

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
            )
            console.log(`Trade record saved successfully: ${tradeId}`)
        } catch (error) {
            console.error(`Error saving trade record: ${tradeId}`, error)
            throw error; // Rethrow the error for handling upstream
        }
    }

    // Retrieve token trading history by propertyId pair
    async getTokenTradeHistoryByPropertyIdPair(propertyId1, propertyId2) {
        const tradeDB = dbFactory.getDatabase('tradeHistory')
        const tradeRecordKey = `token-${propertyId1}-${propertyId2}`;
        const trades = await tradeDB.findAsync({ key: tradeRecordKey })
        return trades.map(doc => doc.trade)
    }

    // Retrieve contract trading history by contractId
    async getContractTradeHistoryByContractId(contractId) {
        console.log('loading trade history for ' + contractId)
        const tradeDB = dbFactory.getDatabase('tradeHistory')
        const tradeRecordKey = `contract-${contractId}`;
        const trades = await tradeDB.findAsync({ key: tradeRecordKey })
        return trades.map(doc => doc.trade)
    }

    // Retrieve trade history by address for both token and contract trades
    async getTradeHistoryByAddress(address) {
        const tradeDB = dbFactory.getDatabase('tradeHistory')
        const trades = await tradeDB.findAsync({
            $or: [{ 'trade.senderAddress': address }, { 'trade.receiverAddress': address }]
        })
        return trades.map(doc => doc.trade)
    }

    // Function to divide two numbers with an option to round up or down to the nearest Satoshi
    divideAndRound(number1, number2, roundUp = false) {
        const result = new BigNumber(number1).dividedBy(new BigNumber(number2))
        return roundUp
            ? result.decimalPlaces(8, BigNumber.ROUND_UP).toString()
            : result.decimalPlaces(8, BigNumber.ROUND_DOWN).toString()
    }

    // Adds a token order to the order book
    async addTokenOrder(order, blockHeight, txid) {
        await tallyMap.updateBalance(order.senderAddress, order.offeredPropertyId, -order.amountOffered, order.amountOffered, 0, 0, false, false, false, txid)

        // Determine the correct orderbook key
        const obKey = this.normalizeOrderBookKey(order.offeredPropertyId, order.desiredPropertyId)
        await this.load(obKey)

        console.log('Normalized Order Book Key:', obKey)

        // Calculate the price for the order and round to the nearest tick interval
        const calculatedPrice = this.calculatePrice(order.amountOffered, order.amountExpected)
        console.log('Calculated Price:', calculatedPrice)
        order.price = calculatedPrice; // Append the calculated price to the order object

        // Determine if the order is a sell order
        const isSellOrder = order.offeredPropertyId < order.desiredPropertyId;

        // Add the order to the orderbook
        const orderConfirmation = this.insertOrder(order, obKey, isSellOrder)
        console.log('Order Insertion Confirmation:', orderConfirmation)

        // Match orders in the orderbook
        const matchResult = await this.matchTokenOrders(obKey)
        if (matchResult.matches && matchResult.matches.length > 0) {
            console.log('Match Result:', matchResult)
            await this.processTokenMatches(matchResult.matches, blockHeight, txid)
        } else {
            console.log('No Matches for ' + txid)
        }

        console.log('Normalized Order Book Key before saving:', obKey)

        await this.save(obKey)

        return matchResult;
    }

    normalizeOrderBookKey(propertyId1, propertyId2) {
        // Ensure lower property ID is first in the key
        return propertyId1 < propertyId2 ? `${propertyId1}-${propertyId2}` : `${propertyId2}-${propertyId1}`;
    }

    insertOrder(order, orderBookKey, isBuyOrder) {
        if (!this.orderBooks[orderBookKey]) {
            this.orderBooks[orderBookKey] = { buy: [], sell: [] };
        }

        const side = isBuyOrder ? 'buy' : 'sell';
        const bookSide = this.orderBooks[orderBookKey][side];

        const index = bookSide.findIndex((o) => o.time > order.time)
        if (index === -1) {
            bookSide.push(order)
        } else {
            bookSide.splice(index, 0, order)
        }
        return `Order added to ${side} side of book ${orderBookKey}`;
    }

    calculatePrice(amountOffered, amountExpected) {
        const priceRatio = new BigNumber(amountOffered).dividedBy(amountExpected)
        console.log('price ratio ' + priceRatio)
        return priceRatio.decimalPlaces(8, BigNumber.ROUND_HALF_UP).toNumber()
    }

    matchTokenOrders(orderBookKey) {
        const orderBook = this.orderBooks[orderBookKey];
        if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
            return { orderBook: this.orderBooks[orderBookKey], matches: [] }; // Return empty matches
        }

        let matches = [];
        let matchOccurred = false;

        // Sort buy and sell orders
        orderBook.buy.sort((a, b) => BigNumber(b.price).comparedTo(a.price) || a.time - b.time) // Highest price first
        orderBook.sell.sort((a, b) => BigNumber(a.price).comparedTo(b.price) || a.time - b.time) // Lowest price first

        // Match orders
        while (orderBook.sell.length > 0 && orderBook.buy.length > 0) {
            let sellOrder = orderBook.sell[0];
            let buyOrder = orderBook.buy[0];

            // Check for price match
            if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                // Ensure that sellOrder.amountOffered and buyOrder.amountExpected are BigNumber objects
                let sellOrderAmountOffered = new BigNumber(sellOrder.amountOffered)
                let buyOrderAmountExpected = new BigNumber(buyOrder.amountExpected)

                // Use BigNumber methods to perform calculations
                let amountOfTokenA = BigNumber.min(sellOrderAmountOffered, buyOrderAmountExpected.times(sellOrder.price))
                let amountOfTokenB = amountOfTokenA.div(sellOrder.price)

                // Update orders after the match
                sellOrder.amountOffered = BigNumber(sellOrder.amountOffered).minus(amountOfTokenA).toNumber()
                buyOrder.amountExpected = BigNumber(buyOrder.amountExpected).minus(amountOfTokenB).toNumber()

                // Add to matches
                matches.push({ sellOrder, buyOrder, amountOfTokenA: amountOfTokenA.toNumber(), amountOfTokenB: amountOfTokenB.toNumber() })
                matchOccurred = true;


                // Remove filled orders from the order book
                if (sellOrder.amountOffered == 0) { orderBook.sell.shift() }
                if (buyOrder.amountExpected == 0) { orderBook.buy.shift() }
            } else {
                break; // No more matches possible
            }
        }

        return { orderBook: this.orderBooks[orderBookKey], matches };
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
                // other relevant trade details...
            };

            // Record the token trade
            await this.recordTokenTrade(trade, blockHeight, txid)

        }
    }

    async addContractOrder(contractId, price, amount, side, insurance, blockTime, txid, sender) {
        console.log('about to call moveCollateralToMargin ' + contractId, amount, sender)
        
        const totalInitialMargin = await contractRegistry.moveCollateralToMargin(sender, contractId, amount)
        if (totalInitialMargin) {
            const marginMap = await MarginMap.load(contractId)
            await marginMap.setInitialMargin(sender, contractId, totalInitialMargin)
        }

        // Create a contract order object with the sell parameter
        const contractOrder = { contractId, amount, price, blockTime, side, sender };

        // The orderBookKey is based on the contractId since it's a derivative contract
        const orderBookKey = `${contractId}`;

        // Load the order book for the given contract
        await this.load(orderBookKey)

        // Insert the contract order into the order book
        this.insertOrder(contractOrder, orderBookKey, side)

        // Match orders in the derivative contract order book
        var matchResult = this.matchContractOrders(orderBookKey)
        if (matchResult != []) {
            console.log('contract match result ' + JSON.stringify(matchResult))
            const inverse = contractRegistry.isInverse(contractId)
            await this.processContractMatches(matchResult.matches, blockTime, contractId, inverse)
        }

        await this.save(orderBookKey)

        return matchResult

    }

    matchContractOrders(orderBookKey) {
        const orderBook = this.orderBooks[orderBookKey];
        if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
            return { orderBook: this.orderBooks[orderBookKey], matches: [] }; // Return empty matches if no orders
        }

        let matches = [];

        // Sort buy and sell orders by price and time
        orderBook.buy.sort((a, b) => BigNumber(b.price).comparedTo(a.price) || a.time - b.time) // Highest price first
        orderBook.sell.sort((a, b) => BigNumber(a.price).comparedTo(b.price) || a.time - b.time) // Lowest price first

        // Match orders
        while (orderBook.sell.length > 0 && orderBook.buy.length > 0) {
            let sellOrder = orderBook.sell[0];
            let buyOrder = orderBook.buy[0];

            // Check for price match
            if (BigNumber(buyOrder.price).isGreaterThanOrEqualTo(sellOrder.price)) {
                // Calculate the amount to be traded
                let tradeAmount = BigNumber.min(sellOrder.amount, buyOrder.amount)

                // Update orders after the match
                sellOrder.amount = BigNumber(sellOrder.amount).minus(tradeAmount).toNumber()
                buyOrder.amount = BigNumber(buyOrder.amount).minus(tradeAmount).toNumber()

                // Add match to the list
                matches.push({
                    sellOrder: { ...sellOrder, amount: tradeAmount.toNumber(), sellerAddress: sellOrder.sender },
                    buyOrder: { ...buyOrder, amount: tradeAmount.toNumber(), buyerAddress: buyOrder.sender }
                })

                // Remove filled orders from the order book
                if (sellOrder.amount === 0) {
                    orderBook.sell.shift()
                }
                if (buyOrder.amount === 0) {
                    orderBook.buy.shift()
                }
            } else {
                break; // No more matches possible
            }
        }

        return { orderBook: this.orderBooks[orderBookKey], matches };
    }

    async processContractMatches(matches, currentBlockHeight, inverse) {
        if (!Array.isArray(matches)) {
            // Handle the non-iterable case, e.g., log an error, initialize as an empty array, etc.
            console.error('Matches is not an array:', matches)
            matches = []; // Initialize as an empty array if that's appropriate
        }

        console.log('processing contract mathces ' + JSON.stringify(matches))

        for (const match of matches) {
            // Load the margin map for the given series ID and block height
            const marginMap = await MarginMap.load(match.sellOrder.contractId)
            console.log('checking the marginMap for contractId ' + marginMap)
            // Get the existing position sizes for buyer and seller
            const buyerPosition = await marginMap.getPositionForAddress(match.buyOrder.buyerAddress)
            const sellerPosition = await marginMap.getPositionForAddress(match.sellOrder.sellerAddress)
            console.log('checking position for trade processing ' + JSON.stringify(buyerPosition) + ' buyer size ' + ' seller size ' + JSON.stringify(sellerPosition))
            console.log('reviewing Match object before processing ' + JSON.stringify(match))
            // Update contract balances for the buyer and seller
            marginMap.updateContractBalances(match.buyOrder.buyerAddress, match.buyOrder.amount, match.buyOrder.price, true, buyerPosition, inverse)
            marginMap.updateContractBalances(match.sellOrder.sellerAddress, match.sellOrder.amount, match.sellOrder.price, false, sellerPosition, inverse)

            // Determine if the trade reduces the position size for buyer or seller
            const isBuyerReducingPosition = buyerPosition > 0 && match.amount < 0;
            const isSellerReducingPosition = sellerPosition < 0 && match.amount > 0;

            // Realize PnL if the trade reduces the position size
            let buyerPnl = 0, sellerPnl = 0;
            if (isBuyerReducingPosition) {
                buyerPnl = marginMap.realizePnl(match.buyerAddress, match.amount, match.price, match.buyerAvgPrice)
            }
            if (isSellerReducingPosition) {
                sellerPnl = marginMap.realizePnl(match.sellerAddress, -match.amount, match.price, match.sellerAvgPrice)
            }
            console.log('params before calling updateMargin ' + match.buyOrder.contractId, match.buyOrder.buyerAddress, match.buyOrder.amount, match.buyOrder.price)
            // Update margin based on the new positions
            marginMap.updateMargin(match.buyOrder.contractId, match.buyOrder.buyerAddress, match.buyOrder.amount, match.buyOrder.price, inverse)
            marginMap.updateMargin(match.sellOrder.contractId, match.sellOrder.sellerAddress, -match.sellOrder.amount, match.sellOrder.price, inverse)

            // Save the updated margin map
            await marginMap.saveMarginMap(currentBlockHeight)

            // Construct a trade object for recording
            const trade = {
                contractId: match.contractId,
                amount: match.amount,
                price: match.price,
                buyerAddress: match.buyOrder.senderAddress,
                sellerAddress: match.sellOrder.senderAddress,
                // other relevant trade details...
            };

            // Record the contract trade
            await this.recordContractTrade(trade, currentBlockHeight, match.txid)


            // Optionally handle the PnL if needed, e.g., logging or further processing
            // ...    
        }
    }

    // Function to return the current state of the order book for the given key
    // getOrderBookData(orderBookKey) {
    //     return this.orderBooks[this.orderBookKey];
    // }
}

exports.orderBook = new Orderbook()
