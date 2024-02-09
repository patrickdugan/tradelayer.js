const dbInstance = require('./db.js');

class Channels {
      // Initialize channelsRegistry as a static property
    static channelsRegistry = new Map();

    
    static async addToRegistry(channelAddress, commiterA, commiterB) {
        // Add logic to register a new trade channel
        this.channelsRegistry.set(channelAddress, { commiterA, commiterB });
        await this.saveChannelsRegistry();
    }

    static async removeFromRegistry(channelAddress) {
        // Add logic to remove a trade channel
        this.channelsRegistry.delete(channelAddress);
        await this.saveChannelsRegistry();
    }

    static async saveChannelsRegistry() {
        // Persist the channels registry to NeDB
        const channelsDB = dbInstance.getDatabase('channels');
        const entries = [...this.channelsRegistry.entries()].map(([channelId, channelData]) => {
            return {
                _id: `${channelId}`, // Unique identifier for each channel
                data: channelData
            };
        });

        for (const entry of entries) {
            await channelsDB.updateAsync(
                { _id: entry._id },
                { $set: { data: entry.data } },
                { upsert: true }
            );
        }
    }

    static async loadChannelsRegistry() {
        // Load the channels registry from NeDB
        const channelsDB = dbInstance.getDatabase('channels');
        try {
            const entries = await channelsDB.findAsync({});
            console.log('loading channel DB '+JSON.stringify(entries))
            this.channelsRegistry = new Map(entries.map(entry => [entry._id.split('-')[1], entry.data]));
            console.log(JSON.stringify(Array.from(this.channelsRegistry.entries())));
            return
        } catch (error) {
            if (error.message.includes('does not exist')) {
                // If the collection does not exist, initialize an empty registry
                this.channelsRegistry = new Map();
            } else {
                throw error;
            }
        }
    }


    // Record a token trade with specific key identifiers
    static async recordTokenTrade(trade, blockHeight, txid) {
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
    static async recordContractTrade(trade, blockHeight, txid) {
        const tradeRecordKey = `contract-${trade.contractId}`;
        const tradeRecord = {
            key: tradeRecordKey,
            type: 'contract',
            trade,
            blockHeight,
            txid
        };
        await this.saveTrade(tradeRecord);
    }

    static async saveTrade(tradeRecord) {
        const tradeDB = dbInstance.getDatabase('tradeHistory');

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
            );
            console.log(`Trade record saved successfully: ${tradeId}`);
        } catch (error) {
            console.error(`Error saving trade record: ${tradeId}`, error);
            throw error; // Rethrow the error for handling upstream
        }
    }


    static async getChannel(channelId) {
        // Ensure the channels registry is loaded
        let channel = this.channelsRegistry.get(channelId)
        if(!channel||channel==undefined||channel==null){
            await this.loadChannelsRegistry();
            channel = this.channelsRegistry.get(channelId)
        }

        return channel
    }

    static async getCommitAddresses(channelAddress) {
        let channel = this.channelsRegistry.get(channelAddress);
        console.log('inside getCommitAddresses '+JSON.stringify(channel))
        if(!channel||channel==undefined||channel==null){
          console.log('channel not found, loading from db')
          await Channels.loadChannelsRegistry()
          channel = this.channelsRegistry.get(channelAddress);
          console.log('checking channel obj again '+JSON.stringify(channel))
        }
        if (channel && channel.participants) {
            const participants = channel.participants;
            console.log('inside getCommitAddresses '+participants.A+ ' '+ participants.B)
            return {
                commitAddressA: participants.A,
                commitAddressB: participants.B
            };
        } else {
            return {commitAddressA: null,commitAddressB: null}; // Return null if the channel or participants data is not found
        }
    }

    static async addCommitment(channelId, commitment) {
        await this.db.updateAsync(
            { channelId: channelId },
            { $push: { commitments: commitment } },
            { upsert: true }
        );
    }

    static async getCommitments(channelId) {
        const channel = await this.db.findOneAsync({ channelId: channelId });
        return channel ? channel.commitments : [];
    }

    static compareCharacters(charA, charB) {
            if (charA === charB) {
                return 0; // Characters are equal
            } else {
                const isNumA = !isNaN(charA);
                const isNumB = !isNaN(charB);
                
                if (isNumA && !isNumB) {
                    return -1; // Numbers come first
                } else if (!isNumA && isNumB) {
                    return 1;
                } else {
                    return charA < charB ? -1 : 1; // Compare ASCII values
                }
            }
    }

    static assignColumnBasedOnAddress(existingChannelAddress, newCommitAddress) {
        // Get the channel information from the registry map object
        const channel = this.channelsRegistry.get(existingChannelAddress);

        // Check if there's a commit address
        if (!channel || !channel.commitAddress) {
            // If there's no commit address, use default logic
            return Channels.assignColumnBasedOnLastCharacter(newCommitAddress);
        }
        let defaultColumn = Channels.assignColumnBasedOnLastCharacter(newCommitAddress);
        let lastUsedColumn = channel.data.lastUsedColumn
        if(defaultColumn==lastUsedColumn){
          // Define the characters considered odd
          const oddCharacters = ['A', 'C', 'E', 'G', 'I', 'K', 'M', 'O', 'Q', 'S', 'U', 'W', 'Y', '1', '3', '5', '7', '9'];
          
          // Get the last characters of the addresses
          const existingLastChar = existingChannelAddress[existingChannelAddress.length - 1].toUpperCase();
          const newLastChar = newCommitAddress[newCommitAddress.length - 1].toUpperCase();

          // Check if the existing address has been assigned to Column A
          const existingIsOdd = oddCharacters.includes(existingLastChar);
          const newIsOdd = oddCharacters.includes(newLastChar);
          let bumpColumn 
          // Check if both addresses are odd or even
          if (existingIsOdd === newIsOdd) {
              // If both addresses are odd or even, compare the last characters
              if (existingLastChar === newLastChar) {
                  // Compare second-to-last characters
                  const existingSecondLastChar = existingChannelAddress[existingChannelAddress.length - 2].toUpperCase();
                  const newSecondLastChar = newCommitAddress[newCommitAddress.length - 2].toUpperCase();

                  // If second-to-last characters are the same, compare third-to-last characters and so on
                  if (existingSecondLastChar === newSecondLastChar) {
                      for (let i = 3; i <= Math.min(existingChannelAddress.length, newCommitAddress.length); i++) {
                          const existingChar = existingChannelAddress[existingChannelAddress.length - i].toUpperCase();
                          const newChar = newCommitAddress[newCommitAddress.length - i].toUpperCase();
                          if (existingChar !== newChar) {
                              // If the new address trumps the existing one, bump the existing address
                              if (existingChar < newChar) {
                                  bumpColumn = existingChar < newChar ? 'A' : 'B'
                                  Channels.bumpColumnAssignment(existingChannelAddress, channel.commitAddress, bumpColumn);
                              }
                              return existingChar < newChar ? 'B' : 'A'; // Assign to opposite column
                          }
                      }
                  } else {
                      // If the new address trumps the existing one, bump the existing address
                      if (existingSecondLastChar < newSecondLastChar) {
                          bumpColumn = existingSecondLastChar < newSecondLastChar ? 'A' : 'B'
                          Channels.bumpColumnAssignment(existingChannelAddress, channel.commitAddress, bumpColumn);
                      }
                      return existingSecondLastChar < newSecondLastChar ? 'B' : 'A'; // Assign to opposite column
                  }
              } else {
                  // If the new address trumps the existing one, bump the existing address
                  if (existingLastChar < newLastChar) {
                      existingLastChar < newLastChar ? 'A' : 'B';
                      Channels.bumpColumnAssignment(existingChannelAddress, channel.commitAddress, bumpColumn);
                  }
                  return existingLastChar < newLastChar ? 'B' : 'A'; // Assign to opposite column
              }
          } else {
              return existingIsOdd ? 'B' : 'A'; // If they are different, assign to opposite of existing
          }
        }
    }

    static assignColumnBasedOnLastCharacter(address) {
        // Get the last character of the address
        const lastChar = address[address.length - 1];
        console.log('last char in assign column based on last character '+lastChar)
        // Define the characters considered odd
        const oddCharacters = ['A', 'C', 'E', 'G', 'I', 'K', 'M', 'O', 'Q', 'S', 'U', 'W', 'Y', '1', '3', '5', '7', '9'];

        // Check if the last character is an odd character
        const isOdd = oddCharacters.includes(lastChar.toUpperCase());
        console.log(isOdd)
        // If the last character is odd, assign to Column A, otherwise assign to Column B
        return isOdd ? 'A' : 'B';
    }

    static bumpColumnAssignment(channelAddress, existingColumn, newColumn) {
      // Get the channel information from the registry map object
      const channel = this.channelsRegistry.get(channelAddress);

      if (!channel) {
          // If the channel doesn't exist, return without performing any action
          return;
      }

      // Get the existing commit address and its corresponding column assignment
      const existingCommitAddress = existingColumn === 'columnA' ? channel.columnAAddress : channel.columnBAddress;

      // Determine the column to be bumped based on the existing and new column assignments
      const columnToBump = existingColumn === 'columnA' ? 'columnB' : 'columnA';

      // Update the channel registry map to overwrite the column assignment of the other commit address
      channel[columnToBump + 'Address'] = existingCommitAddress;
      channel[columnToBump] = existingColumn;

      // Update the channel registry map with the modified channel information
      this.channelsRegistry.set(channelAddress, channel);
  }


    // New function to process commitments and assign columns
    static async processChannelCommits(tradeChannelManager, channelAddress) {
        // Check if both parties have committed
        if (Channels.areBothPartiesCommitted(channelAddress)) {
            // Assign columns based on predefined logic
            const columnAssignments = Channels.assignColumns(channelAddress);
            Channels.updateChannelWithColumnAssignments(channelAddress, columnAssignments);

            console.log(`Columns assigned for channel ${channelAddress}`);
        }
    }

    static async recordCommitToChannel(channelAddress, senderAddress, propertyId, tokenAmount, blockHeight) {
        // Check if the channel exists in the registry
        if (!this.channelsRegistry.has(channelAddress)) {
            // Initialize a new channel record if it doesn't exist
            this.channelsRegistry.set(channelAddress, {
                participants: {'A':'','B':''},
                commits: [],
                A: {},
                B: {},
                lastCommitmentTime: blockHeight,
                lastUsedColumn: null // Initialize lastUsedColumn to null
            });
        }

        // Get the channel from the registry
        const channel = this.channelsRegistry.get(channelAddress);

        // Determine the column for the sender address
        const channelColumn = Channels.assignColumnBasedOnAddress(channelAddress, senderAddress);

        // Update the balance in the specified column
        if (!channel[channelColumn][propertyId]) {
            channel[channelColumn][propertyId] = 0;
        }
        channel[channelColumn][propertyId] += tokenAmount;

        // Add the commit record to the channel
        const commitRecord = {
            senderAddress,
            propertyId,
            tokenAmount,
            block: blockHeight,
            columnAssigned: channelColumn
        };
        channel.participants[channelColumn]=senderAddress;
        channel.commits.push(commitRecord);

        // Update the last commitment time and used column
        channel.lastCommitmentTime = blockHeight;
        channel.lastUsedColumn = channelColumn;

        // Save the updated channel information
        await this.saveChannelsRegistry();

        console.log(`Committed ${tokenAmount} of propertyId ${propertyId} to ${channelColumn} in channel for ${senderAddress}`);
    }

    static areBothPartiesCommitted(channelAddress) {
          const channel = this.channelsRegistry.get(channelAddress);
          if (!channel) return false; // Channel does not exist
          return channel.participants.size === 2; // True if two unique participants have committed
     }

    static adjustChannelBalances(channelAddress, propertyId, amount) {
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
    static processWithdrawal(transaction) {
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

    static processTransfer(transaction) {
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

   static channelTokenTrade(transaction) {
      const { channelAddress, offeredPropertyId, desiredPropertyId, amountOffered, amountExpected, columnAAddress, columnBAddress } = transaction;
      const channel = this.channelsRegistry.get(channelAddress);

      if (!channel) {
          throw new Error('Channel not found');
      }

      // Logic to process token trade and update balances
      if (channel.columnA === columnAAddress) {
          // Column A is the offerer
          TallyMap.updateBalance(channelAddress, offeredPropertyId, 0, -amountOffered, 0,0);
          TallyMap.updateBalance(columnBAddress, desiredPropertyId, 0, amountExpected, 0,0);
      } else {
          // Column B is the offerer
          TallyMap.updateBalance(channelAddress, offeredPropertyId, 0, -amountOffered, 0, 0);
          TallyMap.updateBalance(columnAAddress, desiredPropertyId, 0, amountExpected, 0, 0);
      }

      // Update channel information
      this.channelsRegistry.set(channelAddress, channel);
   }


   static channelContractTrade(transaction) {
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
        channel.committedAmountB -= buyerMargin;
        MarginMap.updateMargin(channel.commitmentAddressA, contractId, amount, price, 'buy');
        MarginMap.updateMargin(channel.commitmentAddressB, contractId, amount, price, 'sell');
        TallyMap.updateBalance(channelAddress, offeredPropertyId, 0, 0, -buyerMargin*2,0);
        TallyMap.updateBalance(channel.commitmentAddressA, desiredPropertyId, 0, 0, buyerMargin, 0);
        TallyMap.updateBalance(channel.commitmentAddressB, desiredPropertyId, 0, 0, buyerMargin, 0);
      } else {
        // Seller's margin is debited from column B
        const sellerMargin = amount * price; // Calculate margin required for the sell side
        if (channel.committedAmountB < sellerMargin) {
          throw new Error('Insufficient margin in channel for seller');
        }
        channel.committedAmountB -= sellerMargin;
        channel.committedAmountA -= sellerMargin;
        MarginMap.updateMargin(channel.commitmentAddressB, contractId, amount, price, 'buy');
        MarginMap.updateMargin(channel.commitmentAddressA, contractId, amount, price, 'sell');
        TallyMap.updateBalance(channelAddress, offeredPropertyId, 0, 0, -buyerMargin*2,0);
        TallyMap.updateBalance(channel.commitmentAddressA, desiredPropertyId, 0, 0, sellerMargin, 0);
        TallyMap.updateBalance(channel.commitmentAddressB, desiredPropertyId, 0, 0, sellerMargin, 0);
      }

      // Update the channel's contract balances
      // This will likely involve updating margin and position in MarginMap
      // Assumed MarginMap.updateMargin function handles the logic of updating margins
      // Example: MarginMap.updateMargin(commitmentAddress, contractId, amount, price, side);

      this.channelsRegistry.set(channelAddress, channel);
    }

    static updateChannelWithColumnAssignments(channelAddress, columnAssignments) {
        const channel = this.channels.get(channelAddress);
        if (!channel) return; // Exit if channel does not exist

        channel.commits = columnAssignments.map(commit => ({
            ...commit,
            columnAssigned: true
        }));
    }
}

module.exports = Channels;
