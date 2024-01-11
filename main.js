const TxUtils = require('./txUtils.js')
const Types = require('./types.js')
const Logic = require('./logic.js')
const { txIndex } = require('./txIndex.js')
const { tlConsensus } = require('./consensus.js')
const { tlActivation } = require('./activation.js')

const GENESIS_BLOCK = 3082500
const COIN = 100000000

class Main {

    constructor(test) {
        this.test = test
        this.genesisBlock = GENESIS_BLOCK;
    }

    async initialize() {
        try {
            await txIndex.ensureGenesisBlock(this.genesisBlock)
            // Proceed with further operations after successful initialization
        } catch (error) {
            console.log('boop')
        }
        console.log('about to check for Index')
        const indexExists = await txIndex.checkForIndex()
        console.log('indexExists' + indexExists)
        if (!indexExists) {
            console.log('building txIndex')
            await this.initOrLoadTxIndex()
            //await txIndex.initializeIndex(this.genesisBlock)

        }

        // Construct consensus from index, or load from Persistence if available
        console.log('constructing consensus state')
        const consensus = await this.constructOrLoadConsensus()

        // Start processing incoming blocks
        await this.processIncomingBlocks(consensus)
    }

    async getCurrentBlockHeight() {
        try {
            const blockchainInfo = await TxUtils.getBlockCountAsync()
            console.log(blockchainInfo)
            return blockchainInfo;
        } catch (error) {
            console.error('Error fetching current block height:', error)
            throw error; // or handle error as needed
        }
    }

    async initOrLoadTxIndex() {
        // Check if the txIndex exists by trying to find the max indexed block
        var maxIndexedBlock = await txIndex.findMaxIndexedBlock()
        console.log('max Indexed Block ' + JSON.stringify(maxIndexedBlock))
        if (maxIndexedBlock === 0 || maxIndexedBlock === null) {
            // Initialize the txIndex if it doesn't exist
            console.log('about to init index with ' + this.genesisBlock)
            await txIndex.ensureGenesisBlock(this.genesisBlock)
            maxIndexedBlock = this.genesisBlock
        }
        // Proceed to synchronize the index
        await this.syncIndex(maxIndexedBlock)
    }

    async syncIndex(maxIndexedBlock) {
        console.log('sync Index maxIndexedBlock ' + maxIndexedBlock)
        try {
            // Find the maximum indexed block in the database
            if (maxIndexedBlock === null) { this.initOrLoadTxIndex() }
            // Fetch the current chain tip (latest block number) from the blockchain
            const chainTip = await TxUtils.getBlockCountAsync()
            console.log('sync index retrieved chaintip ' + chainTip)
            // If the chain tip is greater than the max indexed block, sync the index
            if (chainTip > maxIndexedBlock && (maxIndexedBlock != 0 || maxIndexedBlock != {})) {
                // Loop through each block starting from maxIndexedBlock + 1 to chainTip
                console.log('building tx index ' + maxIndexedBlock)
                return await txIndex.extractBlockData(maxIndexedBlock)
            } else if (maxIndexedBlock == 0 || maxIndexedBlock == {}) {
                console.log('building txIndex from genesis')
                return await txIndex.extractBlockData(this.genesisBlock)
            } else if (maxIndexedBlock == chainTip) {
                console.log("TxIndex is already up to date.")
                return this.constructOrLoadConsensus(maxIndexedBlock)
            }
        } catch (error) {
            console.error("Error during syncIndex:", error)
        }
    }


    async constructOrLoadConsensus() {
        try {
            //const lastSavedHeight = await persistenceDB.get('lastSavedHeight')
            const startHeight = /*lastSavedHeight ||*/ this.genesisBlock;
            return this.constructConsensusFromIndex(startHeight)
        } catch (error) {
            if (error.type === 'NotFoundError') {
                // If no saved state, start constructing consensus from genesis block
                console.log("no consensus found")
                return this.constructConsensusFromIndex(genesisBlockHeight)
            } else {
                console.error('Error loading consensus state:', error)
                throw error;
            }
        }
    }

    async constructConsensusFromIndex(startHeight, realtime) {

        let currentBlockHeight = await txIndex.findMaxIndexedBlock()
        if (realtime != true) {
            console.log('construct Consensus from Index max indexed block ' + currentBlockHeight, 'start height ' + startHeight)
        }

        let maxProcessedHeight = startHeight - 1; // Declare maxProcessedHeight here

        // Apply deltas from the last known block height to the current block height
        //await tallyMapInstance.applyDeltasSinceLastHeight(lastHeight)

        // Fetch all transaction data
        const allTxData = await txIndex.getIndexData()
        //console.log('loaded txIndex '+JSON.stringify(allTxData))
        for (let blockHeight = startHeight; blockHeight <= currentBlockHeight; blockHeight++) {
            // Filter transactions for the current block height
            const txDataSet = allTxData.filter(txData =>
                txData._id.startsWith(`tx-${blockHeight}-`))
            //console.log(txDataSet)
            // Process each transaction
            for (const txData of txDataSet) {
                const txId = txData._id.split('-')[2];
                // Check if the transaction has already been processed
                // TODO: fixme
                // if (await tlConsensuscheckIfTxProcessed(txId)) {
                //     continue; // Skip this transaction if it's already processed
                // }
                //console.log(txId, typeof txId)
                var payload = txData.value.payload;
                //console.log('reading payload in consensus builder '+payload)
                const marker = txData.value.marker
                const type = parseInt(payload.slice(0, 1).toString(36), 36)
                payload = payload.slice(1, payload.length).toString(36)

                // Assuming 'sender' and 'reference' are objects with an 'address' property
                const senderAddress = txData.value.sender.senderAddress;
                const referenceAddress = txData.value.reference.address; //a bit different from the older protocol, not always in the tx, sometimes in OP_Return
                const senderUTXO = txData.value.sender.amount
                const referenceUTXO = txData.value.reference.amount / COIN
                console.log('params to go in during consensus builder ' + type + '  ' + payload + ' ' + senderAddress)
                const decodedParams = await Types.decodePayload(txId, type, marker, payload, senderAddress, referenceAddress, senderUTXO, referenceUTXO)
                decodedParams.block = blockHeight
                //console.log('consensus builder displaying params for tx ' +JSON.stringify(decodedParams))
                if (decodedParams.type > 0) {
                    const activationBlock = tlActivation.getActivationBlock(decodedParams.type)
                    if ((blockHeight < activationBlock) && (decodedParams.valid == true)) {
                        decodedParams.valid = false
                        decodedParams.reason += 'Tx not yet activated despite being otherwise valid '
                        console.log(decodedParams.reason)
                    } else if ((blockHeight < activationBlock) && (decodedParams.valid == true)) {
                        decodedParams.valid = false
                        decodedParams.reason += 'Tx not yet activated in addition to other invalidity issues '
                        console.log(decodedParams.reason)
                    }
                }
                //console.log('decoded params with validity' +JSON.stringify(decodedParams))
                if (decodedParams.valid == true) {
                    //TODO::await tlConsensusmarkTxAsProcessed(txId)
                    console.log('valid tx going in for processing ' + type + JSON.stringify(decodedParams) + ' ' + txId)
                    await Logic.typeSwitch(type, decodedParams)
                    await txIndex.upsertTxValidityAndReason(txId, type, blockHeight, decodedParams.valid, decodedParams.reason)
                } else {
                    //TODO::await tlConsensusmarkTxAsProcessed(txId)
                    await txIndex.upsertTxValidityAndReason(txId, type, blockHeight, decodedParams.valid, decodedParams.reason)
                    console.log('invalid tx ' + decodedParams.reason)
                }
                // Additional processing for each transaction
            }
            maxProcessedHeight = blockHeight; // Update max processed height after each block
        }

        // Calculate the delta (changes made to TallyMap) and save it
        /*const delta = this.calculateDelta()
        await tallyMapInstance.saveDeltaToDB(currentBlockHeight, delta)
        await setMaxConsensusHeightInDB(currentBlockHeight)*/

        try {
            tlConsensus.updateMaxProcessedHeight(maxProcessedHeight)
            if (realtime != true) { console.log('MaxProcessedHeight updated to:', maxProcessedHeight) }
        } catch (error) {
            console.error('Error updating MaxProcessedHeight:', error)
            throw error; // or handle the error as needed
        }

        //insert save of maxProcessedHeight in consensus sub-DB

        if (realtime == false || realtime == undefined || realtime == null) {
            return this.syncIfNecessary()
        } else { return maxProcessedHeight }
    }

    calculateDelta() {
        // Logic to calculate the changes (delta) made to TallyMap
    }

    async syncIfNecessary() {
        const blockLag = await this.checkBlockLag()
        /*if (blockLag > 0) {
            syncIndex() // Sync the txIndexDB
        }else if (blockLag === 0) {*/
        this.processIncomingBlocks(blockLag.lag, blockLag.maxConsensus) // Start processing new blocks as they come
        //}
    }

    async checkBlockLag() {
        const chaintip = await TxUtils.getBlockCountAsync()
        const maxConsensusBlock = await tlConsensus
        //console.log(maxConsensusBlock)
        var lag = chaintip - maxConsensusBlock
        return { 'lag': lag, 'chainTip': chaintip, 'maxConsensus': maxConsensusBlock }
    }


    async processIncomingBlocks(lag, maxConsensusBlock) {
        // Continuously loop through incoming blocks and process them
        let latestProcessedBlock = maxConsensusBlock
        console.log('entering real-time mode ' + latestProcessedBlock)

        while (true) {
            /*if (shutdownRequested) {
                break; // Break the loop if shutdown is requested
            }*/
            const latestBlock = await TxUtils.getBlockCountAsync()
            //console.log(latestBlock)
            for (let blockNumber = latestProcessedBlock + 1; blockNumber <= latestBlock; blockNumber++) {
                const blockData = await txIndex.fetchBlockData(blockNumber)
                await this.processBlock(blockData, blockNumber)
                latestProcessedBlock = blockNumber;
            }

            /*shutdownEmitter.on('shutdown', () => {
                shutdown()
            })*/
            // Wait for a short period before checking for new blocks
            await new Promise(resolve => setTimeout(resolve, 10000)) // 10 seconds
        }
    }

    async processBlock(blockData, blockNumber) {
        // Process the beginning of the block
        await this.blockHandlerBegin(blockData.hash, blockNumber)

        // Process each transaction in the block
        await this.blockHandlerMid(blockData, blockNumber)

        // Process the end of the block
        await this.blockHandlerEnd(blockData.hash, blockNumber)
    }

    async shutdown() {
        console.log('Saving state to database...')
        // Code to save state to database
        console.log('Shutdown completed.')
        process.exit(0) // or use another method to exit gracefully
    }

    async blockHandlerBegin(blockHash, blockHeight) {
        //console.log(`Beginning to process block ${blockHeight}`)

        // Check for reorganization using ReOrgChecker
        /*const reorgDetected = await this.reOrgChecker.checkReOrg() //this needs more fleshing out against persistence DB but in place
        if (reorgDetected) {
            console.log(`Reorganization detected at block ${blockHeight}`)
            await this.handleReorg(blockHeight)
        } else {
            // Proceed with regular block processing
            await this.blockchainPersistence.updateLastKnownBlock(blockHash)
            // Additional block begin logic here
        }*/
        return //console.log('no re-org detected ' +blockHeight)
    }

    async blockHandlerMid(blockHash, blockHeight) {
        try {
            const blockData = await txIndex.fetchBlockData(blockHeight)
            await txIndex.processBlockData(blockData, blockHeight)
            await this.constructConsensusFromIndex(blockHeight, true)
            //console.log(`Processed block ${blockHeight} successfully.`)
        } catch (error) {
            console.error(`Blockhandler Mid Error processing block ${blockHeight}:`, error)
        }
        // Loop through contracts to trigger liquidations
        /*for (const contract of ContractsRegistry.getAllContracts()) {
            if (MarginMap.needsLiquidation(contract)) {
                const orders = await MarginMap.triggerLiquidations(contract)
                // Handle the created liquidation orders
                // ...
            }
        }*/
        return
        //console.log('processed ' + blockHash)
    }

    async blockHandlerEnd(blockHash, blockHeight) {
        //console.log(`Finished processing block ${blockHeight}`)
        // Additional logic for end of block processing

        // Call the method to process confirmed withdrawals
        /*await Channels.processConfirmedWithdrawals()
         for (const contract of ContractsRegistry.getAllContracts()) {
            // Check if the contract has open positions
            if (ContractsRegistry.hasOpenPositions(contract)) {
                // Perform settlement tasks for the contract
                let positions = await Clearing.fetchPositionsForAdjustment(blockHeight, contract)
                const blob = await Clearing.makeSettlement(blockHeight, contract)

                // Perform audit tasks for the contract
                await Clearing.auditSettlementTasks(blockHeight, blob.positions, blob.balanceChanges)
            }
        }*/
        return //console.log('block finish '+blockHeight)
    }

    async handleReorg(blockHeight) {
        //console.log(`Handling reorganization at block ${blockHeight}`)
        // Add logic to handle a blockchain reorganization
        //TODO: fixme: await this.blockchainPersistence.handleReorg()
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
        let propertyTallies = this.tallyMap.get(address)

        if (!propertyTallies) {
            propertyTallies = new Map()
            this.tallyMap.set(address, propertyTallies)
        }

        let currentTally = propertyTallies.get(propertyId) || 0;

        // Update the tally based on the transaction type
        if (transactionType === "send") {
            currentTally -= amount;
        } else if (transactionType === "receive") {
            currentTally += amount;
        }

        // Ensure tallies don't go negative
        currentTally = Math.max(0, currentTally)

        // Update the map with the new tally
        propertyTallies.set(propertyId, currentTally)

        console.log(`Updated tally for address ${address}, property ${propertyId}: ${currentTally}`)
    }

    async processConfirmedWithdrawals() {
        console.log('Checking for confirmed withdrawals...')

        const currentBlockHeight = await this.getCurrentBlockHeight()
        const withdrawalsToProcess = await this.getConfirmedWithdrawals(currentBlockHeight)

        for (const withdrawal of withdrawalsToProcess) {
            if (currentBlockHeight - withdrawal.blockConfirmed >= 8) {
                console.log(`Processing withdrawal for ${withdrawal.channelAddress}`)
                // Process the transfer logic here
                // This might involve interacting with the TradeChannel module
                // and updating the respective balances or state
                await this.tradeChannel.processTransfer(withdrawal)
            }
        }
    }

    async getConfirmedWithdrawals(currentBlockHeight) {
        // Assuming `db` is your database instance configured to interact with your blockchain data
        // The range would be from currentBlockHeight - 8 to currentBlockHeight
        const confirmedWithdrawals = await db.getConfirmedWithdrawals(currentBlockHeight - 8, currentBlockHeight)
        return confirmedWithdrawals;
    }

    async processWithdrawals(currentBlockHeight) {
        const confirmedWithdrawals = await this.getConfirmedWithdrawals(currentBlockHeight)
        for (const withdrawalTx of confirmedWithdrawals) {
            const isValid = await this.validateWithdrawal(withdrawalTx)
            if (isValid) {
                // Process the valid withdrawal
                // This could involve transferring the tokens from the trade channel to the user's address
            } else {
                // Handle invalid withdrawal, e.g., logging, notifying the user, etc.
            }
        }
    }

    async getMaxProcessedHeight() {
        return await tlConsensus.getMaxProcessedHeight()
    }
}

module.exports = Main
