const dbInstance = require('./db.js');
const TallyMap = require('./tally.js')
const BigNumber = require('bignumber.js')
const TxUtils = require('./txUtils.js')


class Channels {
      // Initialize channelsRegistry as a static property
    static channelsRegistry = new Map();
    static pendingWithdrawals = []; // Array to store pending withdrawal objects
   
    
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

       // Function to set a channel object and save it in the registry
    static async setChannel(channelId, channelData) {
        // Set the channel object in the registry
        this.channelsRegistry.set(channelId, channelData);

        // Save the updated channels registry to the database
        await this.saveChannelsRegistry();
    }

    static async saveChannelsRegistry() {
        // Persist the channels registry to NeDB
        const channelsDB = await dbInstance.getDatabase('channels');
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
        const channelsDB = await dbInstance.getDatabase('channels');
        try {
            const entries = await channelsDB.findAsync({});
            //console.log('loading channel DB '+JSON.stringify(entries))
            this.channelsRegistry = new Map(entries.map(entry => [entry._id, entry.data]));
            //console.log(JSON.stringify(Array.from(this.channelsRegistry.entries())));
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

     // Function to save pending withdrawal object to the database
    static async savePendingWithdrawalToDB(withdrawalObj) {
        const withdrawalKey = `withdrawal-${withdrawalObj.blockHeight}-${withdrawalObj.senderAddress}`;
        const withdrawalDB = await dbInstance.getDatabase('withdrawQueue');
        await withdrawalDB.updateAsync(
            { _id: withdrawalKey },
            { $set: { data: withdrawalObj } },
            { upsert: true }
        );
    }

    // Function to load pending withdrawals from the database
    static async loadPendingWithdrawalsFromDB() {
        const withdrawalDB = await dbInstance.getDatabase('withdrawQueue');
        const entries = await withdrawalDB.findAsync({ _id: { $regex: /^withdrawal-/ } });
        return entries.map(entry => entry.data);
    }

    static async removePendingWithdrawalFromDB(withdrawalObj) {
        const withdrawalKey = `withdrawal-${withdrawalObj.blockHeight}-${withdrawalObj.senderAddress}`;
        const withdrawalDB = await dbInstance.getDatabase('withdrawQueue');
        
        // Remove the withdrawal from the database
        await withdrawalDB.removeAsync({ _id: withdrawalKey });
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
        const tradeDB = await dbInstance.getDatabase('tradeHistory');

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
        //console.log('inside getChannel '+channelId+' '+JSON.stringify(Array.from(this.channelsRegistry.entries())));
        console.log(Boolean(!channel),Boolean(channel==undefined),JSON.stringify(channel))
        if(!channel||channel==undefined||channel==null){
            await this.loadChannelsRegistry();
            channel = this.channelsRegistry.get(channelId)
            console.log('in getChannel 2nd hit '+JSON.stringify(channel));
            if(!channel){
              channel=null
            }
        }

        return channel
    }

    static async isValidChannel(channelAddress) {
        // Load the channel from the registry if not already loaded
        let channel = this.channelsRegistry.get(channelAddress);
        if (!channel) {
            await this.loadChannelsRegistry();
            channel = this.channelsRegistry.get(channelAddress);
        }

        // Check if the channel exists
        if (!channel) {
            console.log(`Channel ${channelAddress} does not exist`);
            return false;
        }
    }

    static async getCommitAddresses(channelAddress) {
        let channel = this.channelsRegistry.get(channelAddress);
        //console.log('inside getCommitAddresses '+JSON.stringify(channel)+' '+channelAddress)
        if(!channel||channel==undefined||channel==null){
          console.log('channel not found, loading from db')
          await Channels.loadChannelsRegistry()
          channel = this.channelsRegistry.get(channelAddress);
          //console.log('checking channel obj again '+JSON.stringify(channel))
        }
        if (channel && channel.participants) {
            const participants = channel.participants;
            //console.log('inside getCommitAddresses '+participants.A+ ' '+ participants.B)
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

    static assignColumnBasedOnAddress(channel, newCommitAddress, cpAddress){
        const column = Channels.assignColumnBasedOnLastCharacter(newCommitAddress);   
        // 1) If the channel isn't initialized yet, fall back to last-character rule
        if (!channel.participants.A&&!channel.participants.B) {
            channel.participants[column]=newCommitAddress
            return channel
        }

        // 2) If this address already committed, preserve its column
        if (channel.participants.A === newCommitAddress||channel.participants.B === newCommitAddress){
            return channel
        } 

        // 3) the cp address is assigned and there's no conflict, includes crowded channel
        if(channel.participants[column]!==cpAddress&&!channel.participants[column]){
            channel.participants[column]=newCommitAddress
            return channel
        }
        
        // 4. Crowded: default spot is already filled, so we need tie-break and bump
        if(channel.participants[column]==cpAddress||(channel.participants[column] && channel.participants[column] !== newCommitAddress)){
            const tiebreak = Channels.tieBreakerByBackChar(newCommitAddress, cpAddress, column);
            return Channels.bumpColumnAssignment(
                channel,
                tiebreak.winnerColumn === 'A' ? tiebreak.winner : tiebreak.loser,
                tiebreak.winnerColumn === 'B' ? tiebreak.winner : tiebreak.loser
            );
        }

        console.error(
            `[Channel Assign] Unexpected case in channel assignment for channel ${channel.channel}.\n` +
            `Participants: A=${channel.participants.A}, B=${channel.participants.B}\n` +
            `Incoming commit: ${newCommitAddress}\n` +
            `This should be handled earlier in the logic!`
        );
    }

    static assignColumnBasedOnLastCharacter(address, last=1) {
        // Get the last character of the address
        const lastChar = address[address.length - last];
        console.log('last char in assign column based on last character '+lastChar)
        // Define the characters considered odd
        const oddCharacters = ['A', 'C', 'E', 'G', 'I', 'K', 'M', 'O', 'Q', 'S', 'U', 'W', 'Y', '1', '3', '5', '7', '9'];

        // Check if the last character is an odd character
        const isOdd = oddCharacters.includes(lastChar.toUpperCase());
        console.log(isOdd)
        // If the last character is odd, assign to Column A, otherwise assign to Column B
        return isOdd ? 'A' : 'B';
    }

  /**
 * Tie-breaker to assign addresses to columns based on their last N characters' parity.
 * Returns: { winner: address, loser: address, winnerColumn: 'A' | 'B', loserColumn: 'A' | 'B' }
 */
   static tieBreakerByBackChar(addr1, addr2, column, assignColFunc = Channels.assignColumnBasedOnLastCharacter) {
        const len = Math.min(addr1.length, addr2.length);
        for (let n = 1; n <= len; n++) {
            const col1 = assignColFunc(addr1, n);
            const col2 = assignColFunc(addr2, n);

            console.log(`[TieBreak] Char ${n}: ${addr1}[${col1}] vs ${addr2}[${col2}], competing for ${column}`);

            if (col1 === column && col2 !== column) {
                console.log(`[TieBreak WINNER] ${addr1} wins column ${column} at char -${n}`);
                return {
                    winner: addr1,
                    loser: addr2,
                    winnerColumn: column,
                    loserColumn: column === 'A' ? 'B' : 'A'
                };
            }
            if (col2 === column && col1 !== column) {
                console.log(`[TieBreak WINNER] ${addr2} wins column ${column} at char -${n}`);
                return {
                    winner: addr2,
                    loser: addr1,
                    winnerColumn: column,
                    loserColumn: column === 'A' ? 'B' : 'A'
                };
            }
        }
        // If no decisive winner, default addr1 to the requested column
        console.log(`[TieBreak DEFAULT] ${addr1} assigned ${column} by default (no unique winner)`);
        return {
            winner: addr1,
            loser: addr2,
            winnerColumn: column,
            loserColumn: column === 'A' ? 'B' : 'A'
        };
    }

    static predictColumnForAddress(channel, newCommitAddress, cpAddress) {
    // 1) If channel is empty, fallback to last-character rule
    if (!channel.participants.A && !channel.participants.B) {
        return Channels.assignColumnBasedOnLastCharacter(newCommitAddress);
    }

    // 2) If already present, preserve
    if (channel.participants.A === newCommitAddress) return 'A';
    if (channel.participants.B === newCommitAddress) return 'B';

    // 3) If the computed column is free (not cpAddress), assign
    const column = Channels.assignColumnBasedOnLastCharacter(newCommitAddress);
    if (channel.participants[column] !== cpAddress && !channel.participants[column]) {
        return column;
    }

    // 4) Crowded, tie-break logic
    if (
        channel.participants[column] === cpAddress ||
        (channel.participants[column] && channel.participants[column] !== newCommitAddress)
    ) {
        const tiebreak = Channels.tieBreakerByBackChar(newCommitAddress, cpAddress, column);
        return tiebreak.winnerColumn;
    }

    // fallback: no assignment possible (shouldn't hit)
    return null;
}


   static bumpColumnAssignment(channel, forceAis, forceBis) {
        if (!channel) throw new Error('Channel object is required for bumpColumnAssignment');

        const currentA = channel.participants.A;
        const currentB = channel.participants.B;

        console.log(`[Bump] Current: A=${currentA}, B=${currentB} | Forcing: A=${forceAis}, B=${forceBis}`);

        // If nothing needs to change, just return
        if (currentA === forceAis && currentB === forceBis) {
            console.log('[Bump] No swap needed.');
            return channel;
        }

        // If they are reversed, SWAP participants and all A/B properties
        if (currentA === forceBis) {
            console.log(`[Bump] Swapping A <-> B: ${currentA} <-> ${currentB}`);
            [channel.participants.A, channel.participants.B] = [channel.participants.B, channel.participants.A];
            channel.A = channel.B;
            channel.B = {};
        } else if (currentB === forceAis) {
            console.log(`[Bump] Swapping B <-> A: ${currentB} <-> ${currentA}`);
            [channel.participants.A, channel.participants.B] = [channel.participants.B, channel.participants.A];
            channel.B = channel.A;
            channel.A = {};
        } else {
            // Unusual case—total overwrite?
            console.log(`[Bump] Overwriting participants: A=${forceAis}, B=${forceBis}`);
            channel.participants.A = forceAis;
            channel.participants.B = forceBis;
            // You may want to set or reset balances here if needed.
        }

        console.log(`[Bump] Result: A=${channel.participants.A}, B=${channel.participants.B}`);
        return channel;
    }

    // New function to process commitments and assign columns
    static async processChannelCommits(tradeChannelManager, channelAddress) {
        // Check if both parties have committed
        if (Channels.areBothPartiesCommitted(channelAddress)) {
            // Assign columns based on predefined logic
            const columnAssignments = Channels.assignColumns(channelAddress);
            Channels.updateChannelWithColumnAssignments(channelAddress, columnAssignments);
            //console.log(`Columns assigned for channel ${channelAddress}`);
        }
    }

    // This should be a static method of Channels, adjust class context as needed
    // Returns: { channel, valid, reason }
    static async handleChannelPubkey(channel, column, senderAddress, commitTxid) {
        let valid = true;
        let reason = '';

        //try {
            const tx = await TxUtils.getRawTransaction(commitTxid);
            const vin = tx.vin[0];  // Always use first input

            console.log('vin '+JSON.stringify(vin)+' '+commitTxid)
            const scriptType = TxUtils.getAddressTypeUniversal(senderAddress);
            console.log(scriptType)
            const pubkey = await TxUtils.extractPubkeyByType(vin, scriptType) || [];
            console.log('TxUtils pubkeys'+JSON.stringify(pubkey))
            if (pubkey==null) return new Error('No pubkey found in commit tx');

            // Store/overwrite pubkey for the column
            channel.channelPubkeys[column] = pubkey;

            // If both pubkeys are set, validate multisig address
            const pubA = channel.channelPubkeys.A;
            const pubB = channel.channelPubkeys.B;

            if (pubA && pubB) {
                const Vesting = require('./vesting.js')
                const instance = await Vesting.getInstance()
                const chain = instance.getChain();
                const isTestnet = instance.getTest();
                const multisig1 = await TxUtils.createMultisig(pubA, pubB, chain, isTestnet,senderAddress);
                const multisig2 = await TxUtils.createMultisig(pubB, pubA, chain, isTestnet,senderAddress);

                if (channel.channel !== multisig1 && channel.channel !== multisig2) {
                    valid = false;
                    reason = 'Multisig does not match channel address.';
                    return { channel, valid, reason };
                }
            }

            // All good
            return { channel, valid, reason };

        //} catch (err) {
        //    valid = false;
        //    reason = err.message;
        //    return { channel, valid, reason };
        //}
    }


    static async recordCommitToChannel(channelAddress, senderAddress, propertyId, tokenAmount, payEnabled, clearLists, blockHeight, txid){
        console.log('inside record Commit '+channelAddress+' '+senderAddress+' '+propertyId+' '+tokenAmount+' '+blockHeight+ txid)
          if (!this.channelsRegistry) {
             await this.loadChannelsRegistry();
          }
        // Check if the channel exists in the registry
        if (!this.channelsRegistry.has(channelAddress)) {
            // Initialize a new channel record if it doesn't exist
            this.channelsRegistry.set(channelAddress, {
                participants: {'A':'','B':''},
                channel: channelAddress,
                commits: [],
                A: {},
                B: {},
                lastCommitmentTime: blockHeight,
                lastUsedColumn: null, // Initialize lastUsedColumn to null
                channelPubkeys: {A:'',B:''}
            });
        }

        // Get the channel from the registry
        let channel = this.channelsRegistry.get(channelAddress);
        console.log(JSON.stringify(channel))
        // Determine the column for the sender address
        let cpAddress = ''
        if(channel.participants.A!==senderAddress&&channel.participants.A){
            cpAddress = channel.participants.A
        }else if(channel.participants.B!==senderAddress&&channel.participants.B){
            cpAddress = channel.participants.B
        }
        let channelColumn = Channels.predictColumnForAddress(channel, senderAddress, cpAddress)
        console.log('about to handle pubkeys '+JSON.stringify(channel)+' '+senderAddress+' '+cpAddress)
        const { channel: updatedChannel, valid, reason } = await Channels.handleChannelPubkey(channel, channelColumn, senderAddress, txid);
        if (!valid) {
            console.log('DISPLACED COMMIT USURPER')
            return
        }
        channel = updatedChannel
        console.log('channel after handle pubkeys '+JSON.stringify(channel))
        channel = Channels.assignColumnBasedOnAddress(channel, senderAddress, cpAddress);
        const participants = channel.participants;
        channelColumn =
          participants.A === senderAddress ? 'A' :
          participants.B === senderAddress ? 'B' :
          null;
          if(null){return console.log('ERR WITH COMMIT '+senderAddress+' '+channelAddress+' '+blockHeight)}
        console.log('assinging column in recordCommit' +channelColumn)
        // Update the balance in the specified column
        if (!channel[channelColumn][propertyId]) {
            channel[channelColumn][propertyId] = 0;
        }
        
    const existingBalance = new BigNumber(channel[channelColumn][propertyId] || 0);

    // Add the tokenAmount with 8-decimal precision
    channel[channelColumn][propertyId] = existingBalance
        .plus(new BigNumber(tokenAmount))
        .decimalPlaces(8) // Ensure precision is limited to 8 decimals
        .toNumber();
        console.log('modifying column balance '+tokenAmount+' '+channel[channelColumn][propertyId])
        // Add the commit record to the channel
        const commitRecord = {
            senderAddress,
            propertyId,
            tokenAmount,
            block: blockHeight,
            columnAssigned: channelColumn,
            payEnabled: payEnabled
        };

        if(payEnabled){        
          channel.clearLists[channelColumn]=clearLists
          channel.payEnabled[channelColumn]
        }
        channel.participants[channelColumn]=senderAddress;
        channel.commits.push(commitRecord);

        // Update the last commitment time and used column
        channel.lastCommitmentTime = blockHeight;
        channel.lastUsedColumn = channelColumn;
        console.log(JSON.stringify(channel))
        // Save the updated channel information
        this.channelsRegistry.set(channelAddress,channel)
        await this.saveChannelsRegistry();
        return channel
        console.log(`Committed ${tokenAmount} of propertyId ${propertyId} to ${channelColumn} in channel for ${senderAddress}`);
    }

    static areBothPartiesCommitted(channelAddress) {
          const channel = this.channelsRegistry.get(channelAddress);
          if (!channel) return false; // Channel does not exist
          return channel.participants.size === 2; // True if two unique participants have committed
     }

      // Function to add a pending withdrawal object to the array
    static async addToWithdrawalQueue(blockHeight, senderAddress, amount, channelAddress,propertyId, withdrawAll, column) {
        if(column==false){
          column ="A"
        }else if(column == true){
          column ="B"
        }

        const withdrawalObj = {
            withdrawAll: withdrawAll,
            blockHeight: blockHeight,
            senderAddress: senderAddress,
            amount: amount,
            channel: channelAddress,
            propertyId: propertyId,
            column: column
        };
        this.pendingWithdrawals.push(withdrawalObj);
        await this.savePendingWithdrawalToDB(withdrawalObj);
    }

    // Function to process withdrawals
    static async processWithdrawals(blockHeight) {
        if (this.pendingWithdrawals.length === 0) {
            // Load pending withdrawals from the database if the array is empty
            const pendingWithdrawalsFromDB = await this.loadPendingWithdrawalsFromDB();
            if(pendingWithdrawalsFromDB.length!=0){
               //console.log('inside process withdrawals '+JSON.stringify(Array.from(pendingWithdrawalsFromDB.entries())));
                }
            if (pendingWithdrawalsFromDB.length === 0) {
                return; // No pending withdrawals to process
            } else {
                // Merge loaded pending withdrawals with existing array
                this.pendingWithdrawals.push(...pendingWithdrawalsFromDB);
            }
        }
        //console.log('about to process withdrawals '+blockHeight)
        // Process pending withdrawals
        for (let i = 0; i < this.pendingWithdrawals.length; i++) {
            const withdrawal = this.pendingWithdrawals[i];
            console.log('inside process withdrawals '+JSON.stringify(withdrawal))
            const { block, senderAddress, amount, channel, propertyId, withdrawAll, column } = withdrawal;
            //console.log('about to call getChannel in withdrawals '+channel+' ' +JSON.stringify(withdrawal))
            let thisChannel = await this.getChannel(channel)
            if(thisChannel==undefined){
              //console.log('channel has been removed for 0 balances '+channel)
                this.pendingWithdrawals.splice(i, 1);
                i--;
                await this.removePendingWithdrawalFromDB(withdrawal)
            }
            //console.log('checking thisChannel in withdraw '+JSON.stringify(thisChannel))
            // Function to get current block height

            // Check if it's time to process this withdrawal
            //console.log('seeing if block is advanced enough to clear waiting period '+withdrawal.blockHeight,blockHeight)
            if (blockHeight >= withdrawal.blockHeight + 7) {
                // Check if sender has sufficient balance for withdrawal
                
                //console.log('inside processing block '+JSON.stringify(thisChannel)+' '+channel)
                let column
                if(thisChannel.participants.A==senderAddress){
                  column = "A"
                }else if(thisChannel.participants.B==senderAddress){
                  column = "B"
                }else{
                  //console.log('sender not found on channel '+senderAddress + ' '+channel)
                  continue
                }
                    if(withdrawAll==true){
                        await this.processWithdrawAll(senderAddress,thisChannel,column,blockHeight)
                    }
                let balance
                if(column=="A"){
                  balance = thisChannel.A[propertyId]
                }else if(column=="B"){
                  balance = thisChannel.B[propertyId]
                }
                if (balance >= amount&&!isNaN(amount)) {
                    if(!withdrawAll){
                        await this.processWithdrawal(senderAddress,thisChannel,amount,propertyId,column,blockHeight)
                    }
                  
                    // Remove processed withdrawal from the array
                    this.pendingWithdrawals.splice(i, 1);
                    i--; // Adjust index after removal
                    await this.removePendingWithdrawalFromDB(withdrawal)
                } else {
                    // Insufficient balance, eject the withdrawal from the queue
                    console.log(`Insufficient balance for withdrawal: ${senderAddress}`+' amt'+amount+' prptyid'+propertyId);
                    this.pendingWithdrawals.splice(i, 1);
                    i--; // Adjust index after removal
                    await this.removePendingWithdrawalFromDB(withdrawal)
                }
            }       
        }
        await this.saveChannelsRegistry()
        return 
    }

    static async removeEmptyChannels() {
        for (const [channelAddress, channelData] of this.channelsRegistry.entries()) {
            
            const empty = await this.isChannelEmpty(channelData);
            //console.log('inside remove Empty Channels '+channelAddress+' '+empty+' ' +JSON.stringify(channelData))
            if (empty) {
                this.channelsRegistry.delete(channelAddress);
                //console.log(`Removed empty channel: ${channelAddress}`);
                await this.removeChannelFromDB()
            }
        }
    }

    static async isChannelEmpty(thisChannel) {
        if (!thisChannel || !thisChannel.participants) {
            return true; // Assuming channel is empty if it doesn't exist or has no participants
        }

        const participantA = thisChannel.A || {};
        const participantB = thisChannel.B || {};
        //console.log('inside isChannelEmpty '+JSON.stringify(participantA)+' '+ JSON.stringify(participantB))
      
        // Check if all properties in A and B are 0
        for (const propertyId in participantA) {
          //console.log(participantA[propertyId], Boolean(participantA[propertyId]!==0), Boolean(participantA[propertyId]==0))
            if (participantA[propertyId] !== 0) {
                return false; // Not empty if any property in participantA is not 0
            }
        }
        for (const propertyId in participantB) {
              //console.log(participantA[propertyId],Boolean(participantB[propertyId]!==0), Boolean(participantB[propertyId]==0))
            if (participantB[propertyId] !== 0) {
                return false; // Not empty if any property in participantB is not 0
            }
        }
        return true; // Empty if all properties in A and B are 0
    }

    static async removeChannelFromDB(channelAddress) {
      const channelsDB = await dbInstance.getDatabase('channels');
      const withdrawalKey = `${channelAddress}`;
      
      // Remove the channel entry from the database
      await channelsDB.removeAsync({ _id: withdrawalKey });
  }



    static adjustChannelBalances(channelAddress, propertyId, amount, column) {
          // Logic to adjust the token balances within a channel
          // This could involve debiting or crediting the committed columns based on the PNL amount
          const channel = this.channelsRegistry.get(channelAddress);
          channel[column][propertyId]+=amount
          if (!channel) {
              throw new Error('Trade channel not found');
          }
           this.channelsRegistry.set(channelAddress, channel)
          // Example logic to adjust balances
          // Update the channel's token balances as needed
    }

    // Transaction processing functions
    static async processWithdrawal(senderAddress,channel,amount,propertyId,column,block) {
      // Update balances and logic for withdrawal
      // Example logic, replace with actual business logic
      //console.log('checking channel obj in processWithdrawal '+JSON.stringify(channel))
      //console.log('in processWithdrawal '+channel[column][propertyId])

      let has = await TallyMap.hasSufficientReserve(channel.channel,propertyId,amount)
      console.log(amount, has.hasSufficient)
      if(has.hasSufficient==false){
         amount-=has.shortfall
      }
      console.log(amount, has.shortfall)
      channel[column][propertyId] -= amount;
      console.log('about to modify tallyMap in processWithdrawal '+channel.channel,propertyId,amount,senderAddress)
      await TallyMap.updateChannelBalance(channel.channel, propertyId, -amount, 'channelWithdrawalPull',block)
      await TallyMap.updateBalance(senderAddress,propertyId, amount, 0, 0,0,'channelWithdrawalComplete',block)
      this.channelsRegistry.set(channel.channel, channel);
      return
    }

    static async processWithdrawAll(senderAddress, thisChannel, column,blockHeight) {
        for (const [propertyId, amount] of Object.entries(thisChannel[column])) {
          console.log('in process withdraw all '+senderAddress,thisChannel, amount, propertyId, column)
            await this.processWithdrawal(senderAddress, thisChannel, amount, parseInt(propertyId), column,blockHeight);
        }
    }


    static processTransfer(transaction) {
      // Process a transfer within a trade channel
      const { fromChannel, toChannel, amount, propertyId, transferorIsColumnA, destinationColumn } = transaction;
      const sourceChannel = this.channelsRegistry.get(fromChannel);
      const destinationChannel = this.channelsRegistry.get(toChannel);

      if (!sourceChannel || !destinationChannel) {
        throw new Error('Channel(s) not found');
      }

      // Update balances and logic for transfer
      // Example logic, replace with actual business logic
      if(transferorIsColumnA&&destinationColumn=='A'){
          sourceChannel.A[propertyId] -= amount;
          destinationChannel.A[propertyId] += amount;
      }else if(transferorIsColumnA&&destinationColumn=='B'){
          sourceChannel.A[propertyId] -= amount;
          destinationChannel.B[propertyId] += amount;
      }else if(!transferorIsColumnA&&destinationColumn=='A'){
          sourceChannel.B[propertyId] -= amount
          destinationChannel.A +=amount
      }else if(!transferorIsColumnA&&destinationColumn=='B'){
          sourceChannel.A[propertyId] -= amount
          destinationChannel.B +=amount
      }
     
      this.channelsRegistry.set(fromChannel, sourceChannel);
      this.channelsRegistry.set(toChannel, destinationChannel);
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
