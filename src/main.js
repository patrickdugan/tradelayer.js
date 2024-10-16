// Define a global shutdown event
const EventEmitter = require('events');
class ShutdownEmitter extends EventEmitter {}
const shutdownEmitter = new ShutdownEmitter();
//const fetch = require('node-fetch'); // For HTTP requests (e.g., price lookups)
const util = require('util')
//const listen = require('./listener');
// Custom modules for TradeLayer
//const Clearing =require('./clearing.js')
//const Persistence = require('./Persistence.js'); // Handles data persistence
//const Orderbook = require('./orderbook.js'); // Manages the order book
//const InsuranceFund = require('./insurance.js'); // Manages the insurance fund
//const ReOrgChecker = require('./reOrg.js');
// main.js
const initialize = require('./init');
let client 
let db
(async () => {
    try {
        const { Client, Db } = await initialize();
        client = Client
        db = Db
        console.log('Client and Database initialized successfully.');

        // Now proceed with the rest of your app setup
        /*const Main = require('./main-logic'); // Adjust based on your main logic setup
        const app = new Main(client, db);      // Pass the initialized instances if needed
        app.start(); // Start your app logic*/

    } catch (error) {
        console.error('Failed to initialize client or database.', error);
        process.exit(1);
    }
})();

const fs = require('fs'); // File system module

const Validity = require('./validity.js'); // Module for checking transaction validity
const TxUtils = require('./txUtils.js'); // Utility functions for transactions
const TxIndex = require('./txIndex.js') // Indexes TradeLayer transactions
const TradeChannel = require('./channels.js'); // Manages Trade Channels
const TallyMap = require('./tally.js'); // Manages Tally Mapping
const MarginMap = require('./marginMap.js'); // Manages Margin Mapping
const Clearing = require('./clearing.js')
const Channels = require('./channels.js')
const PropertyManager = require('./property.js'); // Manages properties
const ContractsRegistry = require('./contractRegistry.js'); // Registry for contracts
const VolumeIndex = require('./volumeIndex.js')
const TradeLayerManager = require('./vesting.js')
const Consensus = require('./consensus.js'); // Functions for handling consensus
const Oracles = require('./oracle.js')

const Activation = require('./activation.js')
let activation

(async () => {
    activation = Activation.getInstance()
    await activation.init();
    console.log(`App initialized with Chain: ${activation.chain}, Testnet: ${activation.test}, Admin Address: ${activation.adminAddress}`);
    
    // Continue with the rest of your application setup
    // Initialize other components or start the server, etc.
})();

const Encode = require('./txEncoder.js'); // Encodes transactions
const Types = require('./types.js'); // Defines different types used in the system
const Logic = require('./logic.js')
const AMM = require('./AMM.js')
const Decode = require('./txDecoder.js'); // Decodes transactionsconst db = require('./db.js'); // Adjust the path if necessary
const genesisBlock = 3082500
const COIN = 100000000
const pause = false

class Main {
    static instance;

    constructor(test) {
        console.log('inside main constructor '+Boolean(Main.instance))
        if (Main.instance) {
            console.log('main already initialized')
            return Main.instance;
        }

        this.client=client// Use the already initialized clientInstance  // Initialize the client with the specified chain     
        console.log('client in main ' +this.client)
        //this.tradeLayerManager = new TradeLayerManager();
        this.txIndex = TxIndex.getInstance();  
        this.getBlockCountAsync = () => this.client.getBlockCount();
        this.getNetworkInfoAsync = () => this.client.getNetworkInfo();
        this.genesisBlock = 3082500;
        console.log(this.genesisBlock)
        //this.blockchainPersistence = new Persistence();
        Main.instance = this;
    }

    static async getInstance(test) {
        if (!Main.instance) {
            console.log('getting main')
            Main.instance = new Main(test);
        }
        //this.client =client
        return Main.instance;
    }

    async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
    }

    async initialize() {
        const txIndex = await TxIndex.getInstance();
        try {
            await txIndex.initializeOrLoadDB(this.genesisBlock);
            // Proceed with further operations after successful initialization
        } catch (error) {
            console.log('boop')
        }
          console.log('about to check for Index')
        const indexExists = await TxIndex.checkForIndex();
        console.log('indexExists' + indexExists);
        if (!indexExists) {
            console.log('building txIndex');
            await this.initOrLoadTxIndex()
            //await TxIndex.initializeIndex(this.genesisBlock);

        }

        // Construct consensus from index, or load from Persistence if available
        console.log('constructing consensus state')
        const consensus = await this.constructOrLoadConsensus();

        // Start processing incoming blocks
        //await this.processIncomingBlocks(consensus);
        
    }

    async getCurrentBlockHeight() {
      try {
        const blockchainInfo = await this.getBlockCountAsync();
        console.log(blockchainInfo)
        return blockchainInfo;
      } catch (error) {
        console.error('Error fetching current block height:', error);
        throw error; // or handle error as needed
      }
    }

    async initOrLoadTxIndex() {
        // Check if the txIndex exists by trying to find the max indexed block
        var maxIndexedBlock = await TxIndex.findMaxIndexedBlock();
        console.log('max Indexed Block ' + JSON.stringify(maxIndexedBlock))
        if (maxIndexedBlock === 0 || maxIndexedBlock === null) {
            // Initialize the txIndex if it doesn't exist
            console.log('about to init index with ' +this.genesisBlock)
            await TxIndex.initializeIndex(this.genesisBlock);
            maxIndexedBlock= this.genesisBlock
        }
        // Proceed to synchronize the index
        await this.syncIndex(maxIndexedBlock);
    }

    async syncIndex(maxIndexedBlock) {
      console.log('sync Index maxIndexedBlock '+maxIndexedBlock)
        try {
            // Find the maximum indexed block in the database
            if(maxIndexedBlock===null){this.initOrLoadTxIndex()}
            // Fetch the current chain tip (latest block number) from the blockchain
            const chainTip = await this.getBlockCountAsync()
            console.log('sync index retrieved chaintip '+chainTip)
            // If the chain tip is greater than the max indexed block, sync the index
            if (chainTip > maxIndexedBlock && (maxIndexedBlock !=0 || maxIndexedBlock != {})){
                // Loop through each block starting from maxIndexedBlock + 1 to chainTip
                console.log('building tx index '+maxIndexedBlock)
                return await TxIndex.extractBlockData(maxIndexedBlock)
            } else if(maxIndexedBlock==0|| maxIndexedBlock == {}){
              console.log('building txIndex from genesis')
                return await TxIndex.extractBlockData(this.genesisBlock)
            }else if(maxIndexedBlock==chainTip){

                console.log("TxIndex is already up to date.");
                return this.constructOrLoadConsensus(maxIndexedBlock)
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
            return this.constructConsensusFromIndex(startHeight, false);
        } catch (error) {
            if (error.type === 'NotFoundError') {
                // If no saved state, start constructing consensus from genesis block
                console.log("no consensus found")
                return this.constructConsensusFromIndex(genesisBlockHeight, false);
            } else {
                console.error('Error loading consensus state:', error);
                throw error;
            }
        }
    }

    /*
        Most important function, has two modes, realtime==false means we're catching up and constructing consensus,
        from the txIndex, from genesis until chaintip.
        Real-time==true means we're looping in a delayed timer to check for new blocks and include any new ones in the
        txIndex then apply them to this to update the db and consensus.
    */
       async constructConsensusFromIndex(startHeight) {
            let lastIndexBlock = await TxIndex.findMaxIndexedBlock();
            let blockHeight;
            let maxProcessedHeight = startHeight - 1;

            const txIndexDB = await db.getDatabase('txIndex');
            const tallyMapInstance = TallyMap.getInstance();
            const lastConsensusHeight = await this.loadMaxProcessedHeight();

            // Fetch all transaction data
            const allTxData = await txIndexDB.findAsync({});
            const txDataSet = allTxData.filter(txData => txData._id.startsWith('tx-'));

            // Group transactions by block height
            const txByBlockHeight = txDataSet.reduce((acc, txData) => {
                const txBlockHeight = parseInt(txData._id.split('-')[1]);
                if(!acc[txBlockHeight]){
                    acc[txBlockHeight] = {
                        fundingTx: [],  // Bucket for funding transactions
                        tradeTx: []     // Bucket for regular trade transactions
                    };
                }
                //console.log('troubleshooting 1 '+txData.value)
                // Determine if the transaction is a funding transaction (type starting with 4 or 20)
                let counter1 = 0
                let counter2 = 0
                for(const valueData of txData.value){
                    const payload = valueData.payload;
                    const type = parseInt(payload.slice(0, 1).toString(36), 36);
                    // Assuming types 4 and 20 are the funding types
                    if (type === 4 || type === 20) {
                        counter1++
                        //console.log('logging funding '+counter1+' '+JSON.stringify(txData))
                        acc[txBlockHeight].fundingTx.push(txData);
                    } else {
                        counter2++
                        //console.log('logging other '+counter2+' '+JSON.stringify(txData))
                        acc[txBlockHeight].tradeTx.push(txData);
                    }
                }
                return acc;
            }, {});

            //console.log(JSON.stringify(txByBlockHeight))

            // Determine the last block height with transactions
            const blockHeights = Object.keys(txByBlockHeight).map(Number);
            if (blockHeights.length > 0) {
                lastIndexBlock = Math.max(...blockHeights);
            } else {
                lastIndexBlock = null;
            }

            if (!lastIndexBlock) {
                console.log('No transactions to process.');
                return;
            }

            blockHeight = startHeight;
            console.log('construct Consensus from Index max indexed block ' + lastIndexBlock, 'start height ' + startHeight);

            for (; blockHeight <= lastIndexBlock; blockHeight++) {
                const blockData = txByBlockHeight[blockHeight];

                //if(blockHeight%1000){console.log('block consensus processing '+blockHeight)}
                if (blockData) {
                    if(blockHeight==3432676){
                    console.log('troubleshooting 4'+JSON.stringify(blockData)+' '+'now funding part '+JSON.stringify(blockData.fundingTx)+' '+JSON.stringify(blockData.tradeTx))
                    }
                    // First process funding transactions
                    await this.processTxSet(blockData.fundingTx, blockHeight);

                    // Then process trade transactions
                    await this.processTxSet(blockData.tradeTx, blockHeight);
                }

                // Handle cumulative volumes and vesting after each block
                const cumVolumes = await VolumeIndex.getCumulativeVolumes();
                const thisBlockVolumes = await VolumeIndex.getBlockVolumes(blockHeight);
                if (thisBlockVolumes.global > 0) {
                    console.log('This is a block volume! ' + thisBlockVolumes);
                    const updateVesting = await TradeLayerManager.updateVesting(
                        cumVolumes.ltcPairTotalVolume,
                        thisBlockVolumes.ltcPairs,
                        cumVolumes.globalCumulativeVolume,
                        thisBlockVolumes.global
                    );
                    if (updateVesting != null && updateVesting != undefined && thisBlockVolumes != 0) {
                        console.log('Update Vesting in block ' + blockHeight + ' ' + JSON.stringify(updateVesting));
                        await TallyMap.applyVesting(2, updateVesting.two, blockHeight);
                        await TallyMap.applyVesting(3, updateVesting.three, blockHeight);
                    }
                }

                // Additional processing steps like withdrawal and clearing
                await Channels.processWithdrawals(blockHeight);
                await Clearing.clearingFunction(blockHeight);

                maxProcessedHeight = blockHeight;
            }

            await this.saveMaxProcessedHeight(maxProcessedHeight,false,null);
            return this.syncIfNecessary();
        }

        // Helper function to process a set of transactions
        async processTxSet(txSet, blockHeight) {
            for (const txData of txSet) {
                let flag = false;
                if (blockHeight == 3432676) {
                    console.log('troubleshooting 3 ' + JSON.stringify(txData));
                    flag = true;
                }

                for (const valueData of txData.value) {
                    const txId = valueData.txId;
                    
                    if (await Consensus.checkIfTxProcessed(txId)) {
                        console.log('scanning blockHeight '+blockHeight+' '+tx)
                        continue;
                    }

                    var payload = valueData.payload;
                    const marker = valueData.marker;
                    const type = parseInt(payload.slice(0, 1).toString(36), 36);
                    console.log('type is '+type)
                    payload = payload.slice(1, payload.length).toString(36);
                    const senderAddress = valueData.sender.senderAddress;
                    const referenceAddress = valueData.reference.address;
                    const senderUTXO = valueData.sender.amount;
                    const referenceUTXO = valueData.reference.amount / COIN;

                    if (flag) {
                        console.log('missing tx params ' + txId,
                            type,
                            marker,
                            payload,
                            senderAddress,
                            referenceAddress,
                            senderUTXO,
                            referenceUTXO,
                            blockHeight);
                    }

                    const decodedParams = await Types.decodePayload(
                        txId,
                        type,
                        marker,
                        payload,
                        senderAddress,
                        referenceAddress,
                        senderUTXO,
                        referenceUTXO,
                        blockHeight
                    );

                    if (flag) {
                        console.log('missing tx decode ' + decodedParams);
                    }

                    decodedParams.block = blockHeight;

                    if (decodedParams.valid === true) {
                        console.log('consensus marking valid tx '+decodedParams)
                        await Consensus.markTxAsProcessed(txId, decodedParams);
                        await Logic.typeSwitch(type, decodedParams);
                        await TxIndex.upsertTxValidityAndReason(txId, type, decodedParams.valid, decodedParams.reason);
                    } else {
                        console.log('consensus marking valid tx '+decodedParams)
                        await Consensus.markTxAsProcessed(txId, decodedParams);
                        await TxIndex.upsertTxValidityAndReason(txId, type, decodedParams.valid, decodedParams.reason);
                    }
                }
            }
        }


        async processTx(txSet, blockHeight){
            for (const txData of txSet) {
                        console.log('tx data in real-time'+JSON.stringify(txData))
                        let txId= txData.txId
                        if (await Consensus.checkIfTxProcessed(txId)) {
                            return;
                        }

                        var payload = txData.payload

                        const marker = 'tl';
                        const type = parseInt(payload.slice(0, 1).toString(36), 36);
                        payload = payload.slice(1, payload.length).toString(36);

                        const senderAddress = txData.sender.senderAddress;
                        const referenceAddress = txData.reference.address;
                        const senderUTXO = txData.sender.amount;
                        const referenceUTXO = txData.reference.amount / COIN;
                        console.log('params to go in during consensus builder ' + type + '  ' + payload + ' ' + senderAddress + blockHeight);
                        const decodedParams = await Types.decodePayload(txId, type, marker, payload, senderAddress, referenceAddress, senderUTXO, referenceUTXO,blockHeight);
                        decodedParams.block = blockHeight;

                        if (decodedParams.type > 0) {
                            const activationBlock = activationInstance.getActivationBlock(decodedParams.type);
                            if ((blockHeight < activationBlock) && (decodedParams.valid == true)) {
                                decodedParams.valid = false;
                                decodedParams.reason += 'Tx not yet activated despite being otherwise valid ';
                            } else if ((blockHeight < activationBlock) && (decodedParams.valid == true)) {
                                decodedParams.valid = false;
                                decodedParams.reason += 'Tx not yet activated in addition to other invalidity issues ';
                            }
                        }

                        if (decodedParams.valid === true) {
                            await Consensus.markTxAsProcessed(txId, decodedParams);
                            console.log('valid tx going in for processing ' + type + JSON.stringify(decodedParams) + ' ' + txId + 'blockHeight ' + blockHeight);
                            await Logic.typeSwitch(type, decodedParams);
                            await TxIndex.upsertTxValidityAndReason(txId, type, decodedParams.valid, decodedParams.reason);
                        } else {
                            await Consensus.markTxAsProcessed(txId, decodedParams);
                            await TxIndex.upsertTxValidityAndReason(txId, type, decodedParams.valid, decodedParams.reason);
                            console.log('invalid tx ' + decodedParams.reason);
                        }
                    }
                    return 
        }

    /*originally was an if-logic based switch function but refactoring real-time mode
      it simply is a part of a flow, could be refactored into one function
    */
    async syncIfNecessary() {
        const blockLag = await this.checkBlockLag();
        /*if (blockLag > 0) {
            syncIndex(); // Sync the txIndexDB
        }else if (blockLag === 0) {*/
        if(pause){
            while(pause){
                await delay(1000)
            }
            if(!pause){
                this.processIncomingBlocks(consensus)
            }
        }else{
                this.processIncomingBlocks(blockLag.lag, blockLag.maxTrack, blockLag.chainTip); // Start processing new blocks as they come
        }
        //}
    }

    setPause(){
       if(!pause){
            pause=true 
       }else if(pause){
            pause=false
       }
       return pause
    }

    //updates max consensus block in real-time mode
    async checkBlockLag() {
        const chaintip = await this.getBlockCountAsync()
        let track = await this.loadTrackHeight()
        if(track==null){
            track = await this.loadMaxProcessedHeight()
        }
        //console.log(maxConsensusBlock)
        var lag = chaintip - track
        return {'lag':lag, 'chainTip':chaintip, 'maxTrack':track}
    }

    /*main function of real-time mode*/
    async processIncomingBlocks(lag, maxTrack, chainTip) {
        // Continuously loop through incoming blocks and process them
        let latestProcessedBlock = maxTrack
        console.log('entering real-time mode '+latestProcessedBlock)
        let lagObj
        while (true) {
            /*if (shutdownRequested) {
                break; // Break the loop if shutdown is requested
            }*/
            chainTip = await this.getBlockCountAsync()
            //console.log('latest block '+chainTip+' max track'+latestProcessedBlock)
            let checkTrack = await this.loadTrackHeight()
            if(checkTrack>latestProcessedBlock){latestProcessedBlock=checkTrack}
            for (let blockNumber = latestProcessedBlock + 1; blockNumber <= chainTip; blockNumber++) {
                const networkIsUp = await this.checkNetworkStatus();
                if (!networkIsUp) {
                    console.log('Network down, entering recovery mode.');
                    blockNumber = await this.enterRecoveryMode(latestProcessedBlock, blockNumber);
                }

                const blockData = await TxIndex.fetchBlockData(blockNumber);
                await this.processBlock(blockData, blockNumber);
                let trackHeight = blockNumber;
                //console.log('updating trackHeight'+trackHeight)
                await this.saveTrackHeight(trackHeight)
            }

            if(pause==true){
               console.log('exiting real-time mode '+latestProcessedBlock)  
                break
            };
            // Wait for a short period before checking for new blocks
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
            //console.log('checking block lag '+maxConsensusBlock+' '+chainTip)
            await this.saveTrackHeight(chainTip)
        }
        return syncIfNecessary()
    }

        async checkNetworkStatus() {
            try {
                // Fetch network info using the promisified getnetworkinfo RPC call
                //console.log('about to ping')
                const networkInfo = await this.getNetworkInfoAsync();

                // Check if the network is active
                const networkActive = networkInfo.networkactive;
                const connections = networkInfo.connections;

                //console.log('Network Status:', networkInfo);

                // Determine if there is a potential network outage or issue
                if (!networkActive) {
                    console.error('Network is inactive! The node is not connected to the Bitcoin network.');
                    return { status: false, reason: 'Network inactive' };
                }

                if (connections === 0) {
                    console.warn('Node has 0 connections. It may be isolated from the network.');
                    return { status: false, reason: 'No connections' };
                }

                // If everything seems fine
                //console.log('Network is active with', connections, 'connections.');
                return { status: true, connections: connections };

            } catch (error) {
                // Handle errors such as ECONNREFUSED (cannot connect to the node)
                if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                    console.error(`Network error: ${error.message}. Could not reach the Bitcoin node.`);
                    return { status: 'down', reason: 'Connection refused or timeout' };
                } else {
                    console.error('An unexpected error occurred:', error);
                    throw error; // Rethrow if it's an unexpected error
                }
            }
        }

        async enterRecoveryMode(latestProcessedBlock, trackHeight) {
            console.log('Entering recovery mode, last processed block:', latestProcessedBlock);

            while (true) {
                const networkIsUp = await this.checkNetworkStatus();
                if (networkIsUp.status) {
                    console.log('Network restored, resuming block processing.');

                    // Reload state from the database to ensure we're starting from the correct point
                    const savedTrackHeight = await this.loadTrackHeight();
                    const maxConsensusBlock = await this.loadMaxProcessedHeight();

                    console.log(`Resuming from block: ${latestProcessedBlock}, track height: ${trackHeight}`);
                    return savedTrackHeight; // Exit recovery mode and resume normal processing
                }

                // Retry after a short delay before checking the network again
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }


    /*sub-function of real-time mode, breaks things into 3 steps*/
    async processBlock(blockData, blockNumber) {
        // Process the beginning of the block
        const tx= await this.blockHandlerBegin(blockData.hash, blockNumber);

        // Process each transaction in the block
        blockNumber = await this.blockHandlerMid(tx, blockNumber);

        // Process the end of the block
        await this.blockHandlerEnd(blockData.hash, blockNumber);
        return blockNumber
    }

     async shutdown() {
        console.log('Saving state to database...');
        // Code to save state to database
        console.log('Shutdown completed.');
        process.exit(0); // or use another method to exit gracefully
      }

    async blockHandlerBegin(blockHash, blockHeight) {
        try {
            const blockData = await TxIndex.fetchBlockData(blockHeight);
            const txDetails = await TxIndex.processBlockData(blockData, blockHeight);
            
            if(txDetails.length>=1){
                console.log('processing new tx '+JSON.stringify(txDetails))   
            }
            // Separate out Commit/Transfer transactions from others
            const fundingTxs = [];
            const otherTxs = [];

            for (const tx of txDetails) {
                if (tx.payload.startsWith('4') || tx.payload.startsWith('m')) {
                    fundingTxs.push(tx);
                } else {
                    otherTxs.push(tx);
                }
                console.log('funding tx '+JSON.stringify(fundingTxs))
            }

            // Process Commit/Transfer transactions first
            if (fundingTxs.length > 0) {
                await this.processTx(fundingTxs, blockHeight);
                console.log(`Processed funding txs for block ${blockHeight}`);
            }

            // Pass other transactions to `blockHandlerMid` for processing later
            return otherTxs;  // Store remaining txs for mid-processing
        } catch (error) {
            console.error(`Error in blockHandlerBegin at block ${blockHeight}:`, error);
            return []
        }

         // Check for reorganization using ReOrgChecker
        /*const reorgDetected = await this.reOrgChecker.checkReOrg(); //this needs more fleshing out against persistence DB but in place
        if (reorgDetected) {
            console.log(`Reorganization detected at block ${blockHeight}`);
            await this.handleReorg(blockHeight);
        } else {
            // Proceed with regular block processing
            await this.blockchainPersistence.updateLastKnownBlock(blockHash);
            // Additional block begin logic here
        }*/
    }


    /*middle part of real-time mode processed new tx */
    async blockHandlerMid(txData, blockHeight) {
        try {
            if(txData.length>=1){
                console.log('tx Data for block '+blockHeight + 'txData'+JSON.stringify(txData))
                 await this.processTx(txData,blockHeight)
                 this.saveMaxProcessedHeight(blockHeight) 

            }
           //console.log('about to call construct consensus in block '+blockHeight)
           
            console.log(`Processed block ${blockHeight} successfully...`);
        } catch (error) {
            console.error(`Blockhandler Mid Error processing block ${blockHeight}:`, error);
        }
       // Loop through contracts to trigger liquidations
        /*for (const contract of ContractsRegistry.getAllContracts()) {
            if (MarginMap.needsLiquidation(contract)) {
                const orders = await MarginMap.triggerLiquidations(contract);
                // Handle the created liquidation orders
                // ...
            }
        }*/
        return null 
        //console.log('processed ' + blockHash)
    }

    /*here's where we finish a block processing in real-time mode, handling anything that is done after
    the main tx processing. But since I've stuck the clearing function, channel removal and others in the constructConsensus function
    this is currently also redundant */
    async blockHandlerEnd(blockHash, blockHeight) {

        const cumVolumes = await VolumeIndex.getCumulativeVolumes()
                const thisBlockVolumes = await VolumeIndex.getBlockVolumes(blockHeight)
                if(thisBlockVolumes>0){
                    console.log('this is a block volume! '+thisBlockVolumes)
                    const updateVesting = await TradeLayerManager.updateVesting(cumVolumes.ltcPairTotalVolume,thisBlockVolumes.ltcPairs,cumVolumes.globalCumulativeVolume,thisBlockVolumes.global)
                    if(updateVesting!=null&&updateVesting!=undefined&&thisBlockVolumes!=0){
                    console.log('update Vesting in block' +blockHeight+ ' '+JSON.stringify(updateVesting))
                    await TallyMap.applyVesting(2,updateVesting.two,blockHeight)
                    await TallyMap.applyVesting(3,updateVesting.three,blockHeight)
                    }   
                }
                //console.log(`Finished processing block ${blockHeight}`);
        // Additional logic for end of block processing

        // Call the method to process confirmed withdrawals
        /*await Channels.processConfirmedWithdrawals();
         for (const contract of ContractsRegistry.getAllContracts()) {
            // Check if the contract has open positions
            if (ContractsRegistry.hasOpenPositions(contract)) {
                // Perform settlement tasks for the contract
                let positions = await Clearing.fetchPositionsForAdjustment(blockHeight, contract);
                const blob = await Clearing.makeSettlement(blockHeight, contract);

                // Perform audit tasks for the contract
                await Clearing.auditSettlementTasks(blockHeight, blob.positions, blob.balanceChanges);
            }
        }*/
        return //console.log('block finish '+blockHeight)
    }

    async handleReorg(blockHeight) {
        //console.log(`Handling reorganization at block ${blockHeight}`);
        // Add logic to handle a blockchain reorganization
        await this.blockchainPersistence.handleReorg();
        // This could involve reverting to a previous state, re-processing blocks, etc.
    }

    async saveMaxProcessedHeight(maxProcessedHeight){ 
         try {
            const base = await db.getDatabase('consensus')
             await base.updateAsync(
                    { _id: 'MaxProcessedHeight' },
                    { $set: { value: maxProcessedHeight } },
                    { upsert: true }
                );
                //console.log('realtime mode update '+maxProcessedHeight)
        } catch (error) {
            console.error('Error updating MaxProcessedHeight:', error);
            throw error; // or handle the error as needed
        }
    }

    async saveTrackHeight(saveHeight){
            const base = await db.getDatabase('consensus')
           await base.updateAsync(
                    { _id: 'TrackHeight' },
                    { $set: { value: saveHeight } },
                    { upsert: true }
                    )
    }
 
    async loadMaxProcessedHeight() {
        const consensusDB = await db.getDatabase('consensus'); // Access the consensus sub-database

        try {
            const maxProcessedHeightDoc = await consensusDB.findOneAsync({ _id: 'MaxProcessedHeight' });
            if (maxProcessedHeightDoc) {
                const maxProcessedHeight = maxProcessedHeightDoc.value;
                //console.log('MaxProcessedHeight retrieved:', maxProcessedHeight);
                return maxProcessedHeight; // Return the retrieved value
            } else {
                console.log('MaxProcessedHeight not found in the database.');
                return null; // Return null or an appropriate default value if not found
            }
        } catch (error) {
            console.error('Error retrieving MaxProcessedHeight:', error);
            throw error; // Rethrow the error or handle it as needed
        }
    }

    async loadTrackHeight() {
        const consensusDB = await db.getDatabase('consensus'); // Access the consensus sub-database

        try {
            let track = await consensusDB.findOneAsync({ _id: 'TrackHeight' });
            if (track) {
                track = track.value;
                //console.log('MaxProcessedHeight retrieved:', maxProcessedHeight);
                return track; // Return the retrieved value
            } else {
                console.log('MaxTrackHeight not found in the database.');
                return null; // Return null or an appropriate default value if not found
            }
        } catch (error) {
            console.error('Error retrieving MaxProcessedHeight:', error);
            throw error; // Rethrow the error or handle it as needed
        }
    }

    // ... other methods ...
}

module.exports = Main
