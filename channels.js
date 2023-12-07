const {channelsDB} = require('./db.js');

class TradeChannel {
  constructor() {
    this.channelsRegistry = new Map();
  }

  async addToRegistry(channelAddress, channelData) {
    // Add logic to register a new trade channel
    this.channelsRegistry.set(channelAddress, channelData);
    await this.saveChannelsRegistry();
  }

  async removeFromRegistry(channelAddress) {
    // Add logic to remove a trade channel
    this.channelsRegistry.delete(channelAddress);
    await this.saveChannelsRegistry();
  }

  async saveChannelsRegistry() {
    // Persist the channels registry to LevelDB
    const value = JSON.stringify([...this.channelsRegistry]);
    await db.put('channelsRegistry', value);
  }

  async loadChannelsRegistry() {
    // Load the channels registry from LevelDB
    try {
      const value = await db.get('channelsRegistry');
      this.channelsRegistry = new Map(JSON.parse(value));
    } catch (error) {
      if (error.type === 'NotFoundError') {
        this.channelsRegistry = new Map();
      } else {
        throw error;
      }
    }
  }

  adjustChannelBalances(channelAddress, propertyId, amount) {
        // Logic to adjust the token balances within a channel
        // This could involve debiting or crediting the committed columns based on the PNL amount
        const channel = this.channelsRegistry.get(channelAddress);
        if (!channel) {
            throw new Error('Trade channel not found');
        }

        // Example logic to adjust balances
        // Update the channel's token balances as needed
  }

  // Transaction processing functions
  processWithdrawal(transaction) {
    // Process a withdrawal from a trade channel
    const { channelAddress, amount, propertyId } = transaction;
    const channel = this.channelsRegistry.get(channelAddress);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // Update balances and logic for withdrawal
    // Example logic, replace with actual business logic
    channel.balances[propertyId] -= amount;
    this.channelsRegistry.set(channelAddress, channel);
  }

  processTransfer(transaction) {
    // Process a transfer within a trade channel
    const { fromChannel, toChannel, amount, propertyId } = transaction;
    const sourceChannel = this.channelsRegistry.get(fromChannel);
    const destinationChannel = this.channelsRegistry.get(toChannel);

    if (!sourceChannel || !destinationChannel) {
      throw new Error('Channel(s) not found');
    }

    // Update balances and logic for transfer
    // Example logic, replace with actual business logic
    sourceChannel.balances[propertyId] -= amount;
    destinationChannel.balances[propertyId] += amount;

    this.channelsRegistry.set(fromChannel, sourceChannel);
    this.channelsRegistry.set(toChannel, destinationChannel);
  }

  channelTokenTrade(transaction) {
    // Process a token trade within a trade channel
    const { channelAddress, offeredPropertyId, desiredPropertyId, amountOffered, amountExpected } = transaction;
    const channel = this.channelsRegistry.get(channelAddress);
    
    if (!channel) {
      throw new Error('Channel not found');
    }

    // Update balances and logic for token trade
    // Example logic, replace with actual business logic
    channel.balances[offeredPropertyId] -= amountOffered;
    channel.balances[desiredPropertyId] += amountExpected;

    this.channelsRegistry.set(channelAddress, channel);
  }

  channelContractTrade(transaction) {
    const { channelAddress, contractId, amount, price, side } = transaction;
    const channel = this.channelsRegistry.get(channelAddress);

    if (!channel) {
      throw new Error('Channel not found');
    }

    // Assuming channel object has properties like committedAmountA, committedAmountB for margin
    if (side === 'buy') {
      // Buyer's margin is debited from column A
      const buyerMargin = amount * price; // Calculate margin required for the buy side
      if (channel.committedAmountA < buyerMargin) {
        throw new Error('Insufficient margin in channel for buyer');
      }
      channel.committedAmountA -= buyerMargin;
      MarginMap.updateMargin(channel.commitmentAddressA, contractId, amount, price, 'buy');
    } else {
      // Seller's margin is debited from column B
      const sellerMargin = amount * price; // Calculate margin required for the sell side
      if (channel.committedAmountB < sellerMargin) {
        throw new Error('Insufficient margin in channel for seller');
      }
      channel.committedAmountB -= sellerMargin;
      MarginMap.updateMargin(channel.commitmentAddressB, contractId, amount, price, 'sell');
    }

    // Update the channel's contract balances
    // This will likely involve updating margin and position in MarginMap
    // Assumed MarginMap.updateMargin function handles the logic of updating margins
    // Example: MarginMap.updateMargin(commitmentAddress, contractId, amount, price, side);

    this.channelsRegistry.set(channelAddress, channel);
  }

   determineCommitColumn(senderAddress, transactionTime) {
      // Check if there's an existing channel for this address
      if (!this.channelsRegistry.has(senderAddress)) {
          // If not, this is the first commitment, so use column A
          return 'A';
      }

      const channel = this.channelsRegistry.get(senderAddress);

      // Check the last commitment time to determine the column
      if (!channel.lastCommitmentTime || channel.lastCommitmentTime < transactionTime) {
          // If this is a more recent commitment, switch columns
          return channel.lastUsedColumn === 'A' ? 'B' : 'A';
      } else {
          // Otherwise, use the same column as the last commitment
          return channel.lastUsedColumn;
      }
    }


    async commitToChannel(senderAddress, propertyId, tokenAmount, channelColumn, commitPurpose, transactionTime) {
        if (!this.channelsRegistry.has(senderAddress)) {
            // Initialize a new channel record if it doesn't exist
            this.channelsRegistry.set(senderAddress, {
                A: {},
                B: {},
                lastCommitmentTime: transactionTime,
                lastUsedColumn: channelColumn
            });
        }

        const channel = this.channelsRegistry.get(senderAddress);

        // Update the balance in the specified column
        if (!channel[channelColumn][propertyId]) {
            channel[channelColumn][propertyId] = 0;
        }
        channel[channelColumn][propertyId] += tokenAmount;

        // Update the last commitment time and used column
        channel.lastCommitmentTime = transactionTime;
        channel.lastUsedColumn = channelColumn;

        // Save the updated channel information
        await this.saveChannelsRegistry();  // Assuming there's a method to persist the updated registry

        console.log(`Committed ${tokenAmount} of propertyId ${propertyId} to ${channelColumn} in channel for ${senderAddress} with purpose: ${commitPurpose}`);
    }

}

module.exports = TradeChannel;
