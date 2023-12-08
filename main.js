const level = require('level'); // LevelDB for storage
const fetch = require('node-fetch'); // For HTTP requests (e.g., price lookups)
// Custom modules for TradeLayer
//const Clearing =require('./clearing.js')
//const Persistence = require('./Persistence.js'); // Handles data persistence
//const Orderbook = require('./orderbook.js'); // Manages the order book
//const InsuranceFund = require('./insurance.js'); // Manages the insurance fund
//const VolumeIndex = require('./VolumeIndex.js'); // Tracks and indexes trading volumes
const TradeLayerManager = require('./Vesting.js'); // Handles vesting logic
//const ReOrgChecker = require('./reOrg.js');
const Oracles = require('./oracle.js')
// Additional modules
const Litecoin = require('litecoin'); // Bitcoin RPC module
const fs = require('fs'); // File system module

const Validity = require('./validity.js'); // Module for checking transaction validity
const TxUtils = require('./txUtils.js'); // Utility functions for transactions
const TxIndex = require('./txIndex.js') // Indexes TradeLayer transactions
//const TradeChannel = require('./channels.js'); // Manages Trade Channels
const TallyMap = require('./tally.js'); // Manages Tally Mapping
//const MarginMap = require('./marginMap.js'); // Manages Margin Mapping
const PropertyManager = require('./property.js'); // Manages properties
const ContractsRegistry = require('./contractRegistry.js'); // Registry for contracts
//const Consensus = require('./consensus.js'); // Functions for handling consensus
const Encode = require('./txEncoder.js'); // Encodes transactions
const Types = require('./types.js'); // Defines different types used in the system
const Decode = require('./txDecoder.js'); // Decodes transactions
const { db, txIndexDB,propertyListDB,oracleListDB,contractListDB,tallyMapDB,marginMapsDB, whitelistsDB, clearingDB, consensusDB,persistenceDB} = require('./db.js')
const genesisBlock = 3082500

class Main {
    static instance;

    constructor(test) {
        if (Main.instance) {
            return Main.instance;
        }

        const config = {
            host: '127.0.0.1',
            port: test ? 18332 : 8332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        };

        this.client = new Litecoin.Client(config);
        this.tradeLayerManager = new TradeLayerManager();
        this.txIndex = new TxIndex();
        this.genesisBlock = 3082500;
 //       this.blockchainPersistence = new Persistence();
        Main.instance = this;
    }

    static getInstance(test) {
        if (!Main.instance) {
            Main.instance = new Main(test);
        }
        return Main.instance;
    }

    async initializeOrLoadDB(db, genesisBlock) {
        try {
            const genesis = await txIndexDB.get('genesisBlock');
            console.log('Database already initialized. Genesis block:', genesis);
            // Database already exists, you can load or process data from here
        } catch (error) {
            // If the genesis block is not found, initialize the database
            if (error.type === 'NotFoundError') {
                console.log('Initializing database with genesis block:', genesisBlock);
                await TxIndex.put('genesisBlock', genesisBlock);
                // Perform other initialization tasks if necessary
            } else {
                // Handle other errors
                console.error('Error accessing database:', error);
            }
        }
    }

    async initialize() {

        // Check for existing index, build one if needed
        const indexExists = await TxIndex.checkForIndex();
        console.log('indexExists'+indexExists)
        if (!indexExists) {
            console.log('building txIndex')
            await this.txIndex.buildIndex(this.genesisBlock);
        }

        // Construct consensus from index, or load from Persistence if available
        console.log('constructing consensus state')
        const consensus = await this.constructOrLoadConsensus();

        // Start processing incoming blocks
        await this.processIncomingBlocks(consensus);
    }

    async getCurrentBlockHeight() {
      try {
        const blockchainInfo = await client.cmd('getblockchaininfo');
        return blockchainInfo.blocks;
      } catch (error) {
        console.error('Error fetching current block height:', error);
        throw error; // or handle error as needed
      }
    }

    async initOrLoadTxIndex() {
        // Check if the txIndex exists by trying to find the max indexed block
        const maxIndexedBlock = await TxIndex.findMaxIndexedBlock();
        console.log(maxIndexedBlock)
        if (maxIndexedBlock === 0 || maxIndexedBlock === null) {
            // Initialize the txIndex if it doesn't exist
            await TxIndex.initializeIndex(genesisBlock);
        }
        // Proceed to synchronize the index
        await syncIndex(txIndexDB, txIndexModule, maxIndexedBlock);
    }

    async syncIndex(txIndexDB, txIndexModule) {
        try {
            // Find the maximum indexed block in the database
            const maxIndexedBlock = await TxIndex.findMaxIndexedBlock();
            if(maxIndexedBlock===null){initOrLoadTxIndex}
            // Fetch the current chain tip (latest block number) from the blockchain
            const chainTip = await TxIndex.fetchChainTip();

            // If the chain tip is greater than the max indexed block, sync the index
            if (chainTip > maxIndexedBlock) {
                // Loop through each block starting from maxIndexedBlock + 1 to chainTip
                await TxIndex.extractBlockData(maxIndexedBlock)
                constructOrLoadConsensus()
            } else {
                console.log("TxIndex is already up to date.");
            }
        } catch (error) {
            console.error("Error during syncIndex:", error);
        }
    }


    async constructOrLoadConsensus() {
        let consensusState;
        try {
            //const lastSavedHeight = await persistenceDB.get('lastSavedHeight');
            const startHeight = /*lastSavedHeight ||*/ this.genesisBlock;
            consensusState = await this.constructConsensusFromIndex(startHeight);
        } catch (error) {
            if (error.type === 'NotFoundError') {
                // If no saved state, start constructing consensus from genesis block
                consensusState = await this.constructConsensusFromIndex(genesisBlockHeight);
            } else {
                console.error('Error loading consensus state:', error);
                throw error;
            }
        }
        return consensusState;
    }

    async constructConsensusFromIndex(startHeight) {
    let currentBlockHeight = await TxIndex.findMaxIndexedBlock();
      console.log('maxIndexedBlock = '+currentBlockHeight)
        let maxProcessedHeight = startHeight - 1; // Initialize to one less than startHeight
        for (let blockHeight = startHeight; blockHeight <= currentBlockHeight; blockHeight++) {
        const txDataSet = await TxIndexDB.get(`tx-${blockHeight}`);

          for (const txData of txDataSet) {
              const txId = txData.txid;
              const payload = txData.payload; // Assume payload is included in txData
              const txType = Types.decodeTransactionType(txData); // Function to decode txType from txData

              const decodedParams = Types.decodePayload(txId, txType, payload);
              await Logic.typeSwitch(txType, decodedParams);  // Process liquidations and settlements if necessary
              
              for (const contract of ContractsRegistry.getAllContracts()) {
                      if (MarginMap.needsLiquidation(contract)) {
                          await MarginMap.triggerLiquidations(contract);
                      }
                      if (ContractsRegistry.hasOpenPositions(contract)) {
                          let positions = await Clearing.fetchPositionsForAdjustment(blockHeight, contract);
                          const blob = await Clearing.makeSettlement(blockHeight, contract);
                          await Clearing.auditSettlementTasks(blockHeight, blob.positions, blob.balanceChanges);
                      }
                  }
              }

              // Process channels and other end-of-block logic
              await Channels.processConfirmedWithdrawals();
              maxProcessedHeight = blockHeight; // Update max processed height after each block
              await consensusDB.put('maxConsensusBlock', maxProcessedHeight);

          }

        return syncIfNecessary()
    }

    async syncIfNecessary() {
        const blockLag = await checkBlockLag();
        if (blockLag > 0) {
            syncIndex(); // Sync the txIndexDB
        }else if (blockLag === 0) {
            processIncomingBlocks(); // Start processing new blocks as they come
        }
    }

    async checkBlockLag() {
        const chaintip = await this.txIndex.fetchChainTip();
        const maxConsensusBlock = await consensusDB.get('maxConsensusBlock');
        return chaintip - maxConsensusBlock;
    }


    async processIncomingBlocks(consensus) {
        // Continuously loop through incoming blocks and process them
        let latestProcessedBlock = this.genesisBlock;

        while (true) {
            const latestBlock = await this.txIndex.fetchChainTip();
            for (let blockNumber = latestProcessedBlock + 1; blockNumber <= latestBlock; blockNumber++) {
                const blockData = await this.txIndex.fetchBlockData(blockNumber);
                await this.processBlock(blockData, blockNumber, consensus);
                latestProcessedBlock = blockNumber;
            }
            // Wait for a short period before checking for new blocks
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
        }
    }

    async processBlock(blockData, blockNumber, consensus) {
        // Process the beginning of the block
        await this.blockHandlerBegin(blockData.hash, blockNumber);

        // Process each transaction in the block
        for (const transaction of blockData.tx) {
            await this.blockHandlerMiddle(transaction, blockNumber);
        }

        // Process the end of the block
        await this.blockHandlerEnd(blockData.hash, blockNumber);
    }

     async shutdown() {
        console.log('Shutting down TradeLayer...');
        // Add shutdown logic here
        // This could include saving state, closing database connections, etc.
    }

    async blockHandlerBegin(blockHash, blockHeight) {
        console.log(`Beginning to process block ${blockHeight}`);

        // Check for reorganization using ReOrgChecker
        const reorgDetected = await this.reOrgChecker.checkReOrg(); //this needs more fleshing out against persistence DB but in place
        if (reorgDetected) {
            console.log(`Reorganization detected at block ${blockHeight}`);
            await this.handleReorg(blockHeight);
        } else {
            // Proceed with regular block processing
            await this.blockchainPersistence.updateLastKnownBlock(blockHash);
            // Additional block begin logic here
        }
    }

    async blockHandlerMiddle(blockHash, blockHeight) {
        console.log(`Processing transactions in block ${blockHeight}`);

        // Retrieve the block data
        const blockData = await this.txIndex.fetchBlockData(blockHeight);

        // Iterate over each transaction in the block
        for (const txId of blockData.tx) {
            try {
                // Fetch detailed transaction data
                const txData = await TxUtils.getRawTransaction(txId);

                // Extract and decode the payload
                const payload = TxUtils.getPayload(txId);
                const txType = TxUtils.decodeTransactionType(txData);

                // Decode the transaction based on its type and payload
                const decodedParams = Types.decodePayload(txId, txType, payload);

                // Process the transaction based on the decoded parameters
                await TxIndex.processTransaction(txType, decodedParams, blockHeight);
                Logic.typeSwitch(txType, decodedParams);

            } catch (error) {
                console.error(`Error processing transaction ${txId}: ${error.message}`);
            }
        }

         // Loop through contracts to trigger liquidations
        for (const contract of ContractsRegistry.getAllContracts()) {
            if (MarginMap.needsLiquidation(contract)) {
                const orders = await MarginMap.triggerLiquidations(contract);
                // Handle the created liquidation orders
                // ...
            }
        }
    }

    async blockHandlerEnd(blockHash, blockHeight) {
        console.log(`Finished processing block ${blockHeight}`);
        // Additional logic for end of block processing

        // Call the method to process confirmed withdrawals
        await Channels.processConfirmedWithdrawals();
         for (const contract of ContractsRegistry.getAllContracts()) {
            // Check if the contract has open positions
            if (ContractsRegistry.hasOpenPositions(contract)) {
                // Perform settlement tasks for the contract
                let positions = await Clearing.fetchPositionsForAdjustment(blockHeight, contract);
                const blob = await Clearing.makeSettlement(blockHeight, contract);

                // Perform audit tasks for the contract
                await Clearing.auditSettlementTasks(blockHeight, blob.positions, blob.balanceChanges);
            }
        }
    }

    async handleReorg(blockHeight) {
        console.log(`Handling reorganization at block ${blockHeight}`);
        // Add logic to handle a blockchain reorganization
        await this.blockchainPersistence.handleReorg();
        // This could involve reverting to a previous state, re-processing blocks, etc.
    }

    /**
     * Updates the tally map based on the given transaction.
     * @param {string} address - The address whose tally is to be updated.
     * @param {number} amount - The amount by which to update the tally.
     * @param {string} propertyId - The identifier of the property or token.
     * @param {string} transactionType - The type of transaction (e.g., "send", "receive").
     */
    updateTallyMap(address, amount, propertyId, transactionType) {
        // Assuming tallyMap is a Map where each key is an address and each value is another Map,
        // which maps property IDs to their respective tallies.
        let propertyTallies = this.tallyMap.get(address);

        if (!propertyTallies) {
            propertyTallies = new Map();
            this.tallyMap.set(address, propertyTallies);
        }

        let currentTally = propertyTallies.get(propertyId) || 0;

        // Update the tally based on the transaction type
        if (transactionType === "send") {
            currentTally -= amount;
        } else if (transactionType === "receive") {
            currentTally += amount;
        }

        // Ensure tallies don't go negative
        currentTally = Math.max(0, currentTally);

        // Update the map with the new tally
        propertyTallies.set(propertyId, currentTally);

        console.log(`Updated tally for address ${address}, property ${propertyId}: ${currentTally}`);
    }

    async processConfirmedWithdrawals() {
        console.log('Checking for confirmed withdrawals...');

        const currentBlockHeight = await this.getCurrentBlockHeight();
        const withdrawalsToProcess = await this.getConfirmedWithdrawals(currentBlockHeight);

        for (const withdrawal of withdrawalsToProcess) {
            if (currentBlockHeight - withdrawal.blockConfirmed >= 8) {
                console.log(`Processing withdrawal for ${withdrawal.channelAddress}`);
                // Process the transfer logic here
                // This might involve interacting with the TradeChannel module
                // and updating the respective balances or state
                await this.tradeChannel.processTransfer(withdrawal);
            }
        }
    }

    async getConfirmedWithdrawals(currentBlockHeight) {
        // Assuming `db` is your database instance configured to interact with your blockchain data
        // The range would be from currentBlockHeight - 8 to currentBlockHeight
        const confirmedWithdrawals = await db.getConfirmedWithdrawals(currentBlockHeight - 8, currentBlockHeight);
        return confirmedWithdrawals;
    }

    async processWithdrawals(currentBlockHeight) {
      const confirmedWithdrawals = await this.getConfirmedWithdrawals(currentBlockHeight);
      for (const withdrawalTx of confirmedWithdrawals) {
          const isValid = await this.validateWithdrawal(withdrawalTx);
          if (isValid) {
              // Process the valid withdrawal
              // This could involve transferring the tokens from the trade channel to the user's address
          } else {
              // Handle invalid withdrawal, e.g., logging, notifying the user, etc.
          }
      }
    }

    // ... other methods ...
}

module.exports = Main
