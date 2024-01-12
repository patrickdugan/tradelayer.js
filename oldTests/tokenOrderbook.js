const BigNumber = require('bignumber.js');
const level = require('level');

class TokenOrderbook {
  constructor(dbPath, tickSize = new BigNumber('0.000000001')) {
    this.tickSize = tickSize;
    this.db = level(dbPath);
    this.orderBooks = {}; // This will be populated from LevelDB
    this.loadOrderBooks(); // Load existing order books from LevelDB
  }

  async loadOrderBooks() {
    // Load order books from LevelDB
    for await (const [key, value] of this.db.iterator({ gt: 'book-', lt: 'book-\xFF' })) {
      this.orderBooks[key.split('-')[1]] = JSON.parse(value);
    }
  }

  async saveOrderBook(pair) {
    // Save order book to LevelDB
    await this.db.put(`book-${pair}`, JSON.stringify(this.orderBooks[pair]));
  }

  // Adds a token order to the order book
  addTokenOrder({ propertyIdNumber, propertyIdNumberDesired, amountOffered, amountExpected, time }) {
    const price = this.calculatePrice(amountOffered, amountExpected);
    const order = { propertyIdNumber, propertyIdNumberDesired, amountOffered, amountExpected, price, time };

    const orderBookKey = `${propertyIdNumber}-${propertyIdNumberDesired}`;
    this.insertOrder(order, orderBookKey);
    this.matchOrders(orderBookKey);
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

  insertOrder(order, orderBookKey, isContractOrder = false) {
    // If order book does not exist, create it
    if (!this.orderBooks[orderBookKey]) {
      this.orderBooks[orderBookKey] = { buy: [], sell: [] };
    }

    // Determine if it's a buy or sell order based on the property IDs
    if(isContractOrder==false){
        const side = order.propertyIdNumber < order.propertyIdNumberDesired ? 'buy' : 'sell';
    }else if(isContractOrder==true&&sell==true){
      const side = 'sell';
    }else if(isContractOrder==true&&sell==false){
      const side = 'buy'
    }
    // Insert the order into the correct side of the book
    const bookSide = this.orderBooks[orderBookKey][side];
    const index = bookSide.findIndex((o) => o.time > order.time);
    if (index === -1) {
      bookSide.push(order);
    } else {
      bookSide.splice(index, 0, order);
    }

    // Save the updated order book
    this.saveOrderBook(orderBookKey);
  }

  calculatePrice(amountOffered, amountExpected) {
    const priceRatio = new BigNumber(amountOffered).dividedBy(amountExpected);
    return priceRatio.decimalPlaces(8, BigNumber.ROUND_HALF_UP);
  }

  matchOrders(orderBookKey, isContract = false) {
    const orderBook = this.orderBooks[orderBookKey];
    if (!orderBook || orderBook.buy.length === 0 || orderBook.sell.length === 0) {
      return; // Nothing to match
    }

    const matches = [];

    // Sort buy orders from highest to lowest price and sell orders from lowest to highest price
    orderBook.buy.sort((a, b) => b.price.comparedTo(a.price) || a.time - b.time); // Highest price and oldest first
    orderBook.sell.sort((a, b) => a.price.comparedTo(b.price) || a.time - b.time); // Lowest price and oldest first

    // While there is still potential for matches
    while (orderBook.sell.length > 0 && orderBook.buy.length > 0 &&
           orderBook.sell[0].price.lte(orderBook.buy[0].price)) {
      
      // Match the top of the buy and sell orders
      let sellOrder = orderBook.sell[0];
      let buyOrder = orderBook.buy[0];

      // Determine the amount to trade which is the minimum of the two orders
      const amountToTrade = BigNumber.minimum(sellOrder.amountOffered, buyOrder.amountExpected);

      // Update orders
      sellOrder.amountOffered = sellOrder.amountOffered.minus(amountToTrade);
      buyOrder.amountExpected = buyOrder.amountExpected.minus(amountToTrade);

      // Deduct taker fee from buyer and give maker rebate to seller
      if(isContract==false){
          const takerFee = amountToTrade.times(0.0002);
          const makerRebate = takerFee.div(2);
      }

      if(isContract==true){
          const takerFee = amountToTrade.times(0.0001);
          const makerRebate = takerFee.div(2);
      }
      buyOrder.amountExpected = buyOrder.amountExpected.minus(takerFee);
      sellOrder.amountOffered = sellOrder.amountOffered.plus(makerRebate);

      // If an order is completely filled, remove it from the order book
      if (sellOrder.amountOffered.isZero()) {
        orderBook.sell.shift(); // Remove the sell order
      }
      if (buyOrder.amountExpected.isZero()) {
        orderBook.buy.shift(); // Remove the buy order
      }

      const matchedOrderDetails = {
              sellOrderId: sellOrder.id, // Assuming we have unique IDs for orders 
              buyOrderId: buyOrder.id,
              amountToTrade: amountToTrade.toString(),
              price: sellOrder.price.toString(),
              takerFee: takerFee.toString(),
              makerRebate: makerRebate.toString()
            };
  
      matches.push(matchedOrderDetails);

      // Partial matches: remaining amounts stay in the order book
      // (They are already updated in the order objects)
    }// Process the matches differently based on whether they're token or contract matches

        const matchResults = {
            orderBook: this.orderBooks[orderBookKey],
            matches
        };
 
       if (isContract) {
        this.processContractMatches(matchResults.matches);
        } else {
        this.processTokenMatches(matchResults.matches);
      }

      this.saveOrderBook(orderBookKey);

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
          await marginMap.save(currentBlockHeight);

          // Optionally handle the PnL if needed, e.g., logging or further processing
          // ...

        } catch (error) {
          console.error(`Error processing contract match ${match.id}:`, error);
          // Handle error, potentially rolling back any partial updates or retrying
        }
      }
    }
}


module.exports = TokenOrderbook;
