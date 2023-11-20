// Import necessary modules
const Clearing = require('clearing.js');
const TradeLayerManager = require('./TradeLayerManager.js');
const Persistence = require('./Persistence.js');
const Orderbook = require('./Orderbook.js');
const InsuranceFund = require('./InsuranceFund.js');
const VolumeIndex = require('./VolumeIndex.js');
const Vesting = require('./Vesting.js');
const TxIndex = require('./TxIndex.js');
const ReOrgChecker = require('./reOrg.js');
const fs = require('fs');
const Validity = require('./validity.js');
const TxUtils = require('./txUtils.js');
const TradeChannel = require('./channels.js');
const TallyMap = require('./tally.js');
const MarginMap = require('./marginMap.js');
const PropertyManager = require('./property.js');
const ContractsRegistry = require('./contractsRegistry.js');
const Consensus = require('./consensus.js');
const Encode = require('./txEncoder.js');
const Types = require('./types.js');
const Decode = require('./txDecoder.js');


class Interface {
    constructor() {
        // Initialize modules
        this.clearing = new Clearing();
        this.tradeLayerManager = new TradeLayerManager();
        this.persistence = new Persistence();
        this.orderbook = new Orderbook();
        this.insuranceFund = new InsuranceFund();
        this.volumeIndex = new VolumeIndex();
        this.vesting = new Vesting();
        this.txIndex = new TxIndex();
        this.reOrgChecker = new ReOrgChecker();
        this.litecoin = new Litecoin();
        this.validity = new Validity();
        this.txUtils = new TxUtils();
        this.tradeChannel = new TradeChannel();
        this.tallyMap = new TallyMap();
        this.marginMap = new MarginMap();
        this.propertyManager = new PropertyManager();
        this.contractsRegistry = new ContractsRegistry();
        this.consensus = new Consensus();
        this.encode = new Encode();
        this.types = new Types();
        this.decode = new Decode();

        // ... any additional initializations ...
    },const fs = require('fs');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// Import all necessary modules
const TradeLayerManager = require('./TradeLayerManager');
const Persistence = require('./Persistence');
const Orderbook = require('./Orderbook');
const InsuranceFund = require('./InsuranceFund');
const VolumeIndex = require('./VolumeIndex');
const Vesting = require('./Vesting');
const TxIndex = require('./TxIndex');
const ReOrgChecker = require('./reOrg');
const Validity = require('./validity');
const TxUtils = require('./txUtils');
const TradeChannel = require('./channels');
const TallyMap = require('./tally');
const MarginMap = require('./marginMap');
const PropertyManager = require('./property');
const ContractsRegistry = require('./contractsRegistry');
const Consensus = require('./consensus');
const Encode = require('./txEncoder');
const Types = require('./types');
const Decode = require('./txDecoder');
const Clearing = require('./clearing');

class Interface {
    constructor() {
        // Singleton instances or references to the modules can be set up here if necessary
        this.tallyMap = TallyMap.getSingletonInstance();
    },

    async JSONAuditTallyMap() {
        await TallyMap.load(); // Load the TallyMap
        const tallyMapData = TallyMap.getTallyMapData();
        const tallyMapStream = this.createReadableStreamFromIterable(tallyMapData);
        const writableStream = fs.createWriteStream('tallyMapAudit.json');

        try {
            await pipeline(
                tallyMapStream,
                writableStream
            );
            console.log('Tally map audit saved to tallyMapAudit.json');
        } catch (error) {
            console.error('Error streaming tally map to file:', error);
        }
    },

    createReadableStreamFromIterable(iterable) {
        const iterator = iterable[Symbol.iterator]();
        return new stream.Readable({
            objectMode: true,
            read() {
                const { value, done } = iterator.next();
                if (done) {
                    this.push(null);
                } else {
                    this.push(JSON.stringify(value, null, 4) + '\n');
                }
            }
        });
    },

    async getConsensusHashForBlock(blockHeight) {
        return await Consensus.getData(`consensusHash_${blockHeight}`);
    },

    async getFeatureActivationStatus(featureId) {
        return TradeLayerManager.isTxTypeActive(featureId) ? { status: 'active' } : { status: 'inactive', message: `Feature ID ${featureId} not found or not active.` };
    },

    async getAllBalancesForAddress(address) {
        return await TallyMap.getAddressBalances(address);
    },

    getTotalTokens(propertyId) {
        return TallyMap.totalTokens(propertyId);
    },

    async getBalancesAcrossAllWallets() {
        // Assuming a function in TradeLayerManager to get all wallet balances
        return TradeLayerManager.getAllBalances();
    },

    async isTransactionTypeActive(txType) {
        return TradeLayerManager.isTxTypeActive(txType);
    },

    async getAllActiveTransactionTypes() {
        return TradeLayerManager.getActiveTransactionTypes();
    },

    async getAddressesWithBalanceForProperty(propertyId) {
        return await TallyMap.getAddressesWithBalanceForProperty(propertyId);
    },

    async getTransaction(txid) {
        return await TxIndex.getTransactionDetails(txid);
    },

    async getProperty(propertyId) {
        return await PropertyManager.getPropertyDetails(propertyId);
    },

    async listProperties() {
        return await PropertyManager.getAllProperties();
    },

    async getGrants(propertyId) {
        return await PropertyManager.getPropertyGrants(propertyId);
    },

    async getPayToToken(propertyId) {
        return await TxUtils.getPayToTokenTransactions(propertyId);
    },

    async listBlockTransactions(blockIndex) {
        return await BlockHistory.getBlockTransactions(blockIndex);
    },

    async listBlocksTransactions(firstBlock, lastBlock) {
        return await BlockHistory.getTransactionsInRange(firstBlock, lastBlock);
    },

    async listPendingTransactions(addressFilter = '') {
        return await TxUtils.getPendingTransactions(addressFilter);
    },

    async getBalancesAcrossAllWallets() {
        // Assuming WalletCache provides a method to get all balances across wallets
        return await WalletCache.getAllBalances();
    },

    // Add other wallet-related methods as needed...
    // For example, a method to update the wallet cache
    async updateWalletCache() {
        await WalletCache.updateCache();
        return 'Wallet cache updated';
    },

    async listOracles() {
        // Assuming a method in the OracleManager module that lists all oracles
        return await OracleManager.listAllOracles();
    },

    /**
     * Retrieves a list of all whitelists.
     */
    async listWhitelists() {
        // Assuming a method in the WhitelistManager module that lists all whitelists
        return await WhitelistManager.listAllWhitelists();
    },

    /**
     * Retrieves a list of vaults for a given synthetic property ID.
     * @param {number} propertyId - The synthetic property ID.
     */
    async listVaultsBySyntheticProperty(propertyId) {
        // Assuming a method in the VaultManager module that lists vaults by property ID
        return await VaultManager.listVaultsForProperty(propertyId);
    },

    /**
     * Retrieves options chains by series ID.
     * @param {number} seriesId - The series ID.
     */
    async getOptionsChainBySeriesId(seriesId) {
        // Assuming a method in the OptionsChainManager module that gets an options chain by series ID
        return await OptionsChainManager.getOptionsChain(seriesId);
    },

     /**
     * Retrieves the balance of the insurance fund for a given contract ID.
     * @param {number} contractId - The contract ID.
     */
    async getInsuranceFundBalance(contractId) {
        // Assuming a method in the InsuranceFund module that retrieves the balance for a specific contract
        return await InsuranceFund.getBalanceForContract(contractId);
    },

   /**
     * Retrieves the insurance fund payout history for a given contract ID between specified blocks.
     * If endBlock is not provided, it defaults to the latest block height.
     * @param {number} contractId - The contract ID.
     * @param {number} startBlock - The starting block number.
     * @param {number|null} endBlock - The ending block number (defaults to the latest block).
     */
    async getInsuranceFundPayoutHistory(contractId, startBlock, endBlock = null) {
        if (endBlock === null) {
            // Assuming a method in a suitable module (e.g., BlockChainInfo) that retrieves the latest block height
            endBlock = await BlockChainInfo.getLatestBlockHeight();
        }

        // Assuming a method in the InsuranceFund module that retrieves the payout history
        return await InsuranceFund.getPayoutHistoryForContract(contractId, startBlock, endBlock);
    }

        /**
     * Retrieves audit data for a specific block and contract.
     * @param {number} blockHeight - The block height for which to retrieve audit data.
     * @param {number} contractId - The contract ID to focus on.
     * @returns {Promise<Object>} - The audit data, or an error if not found.
     */
    async getAuditData(blockHeight, contractId) {
        try {
            const auditDataKey = `contract-${contractId}-block-${blockHeight}`;
            const auditData = await this.clearing.fetchAuditData(auditDataKey);
            return auditData;
        } catch (error) {
            console.error('Error retrieving audit data:', error);
            throw error; // Or handle it more gracefully depending on your application's needs
        }
    }

}

module.exports = Interface;
