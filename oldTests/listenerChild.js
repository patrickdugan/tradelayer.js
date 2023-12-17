const TallyMap = require('./tally');
const TxIndex = require('./TxIndex');
const PropertyManager = require('./property');
const Interface = require('./Interface');
const interfaceInstance = new Interface();
const Main = require('./main.js')

// ... Import other necessary modules ...

async function listen() {
     process.on('message', async (message) => {
        console.log('Child process received message:', message);
        try {
            const { command, args } = message;
            switch (command) {

                case 'initMain':
                    console.log('initializing')
                     const mainProcessor = Main.getInstance(test = true); // Assuming 'test' is a parameter for testing
                     mainProcessor.initialize();
                    
                    // Send a response back to the child process to indicate successful initialization
                    process.send({ data: 'Main process initialized successfully' });
                    break;

                case 'getAllBalancesForAddress':
                    const balances = await TallyMap.getAddressBalances(args.address);
                    process.send({ data: balances });
                    break;

                case 'getTransaction':
                    const transaction = await TxIndex.getTransactionDetails(args.txid);
                    process.send({ data: transaction });
                    break;


                case 'getConsensusHashForBlock':
                    result = await interfaceInstance.getConsensusHashForBlock(args.blockHeight);
                    break;

                case 'getFeatureActivationStatus':
                    result = await interfaceInstance.getFeatureActivationStatus(args.featureId);
                    break;

                case 'getAllBalancesForAddress':
                    result = await interfaceInstance.getAllBalancesForAddress(args.address);
                    break;

                case 'getTotalTokens':
                    result = await interfaceInstance.getTotalTokens(args.propertyId);
                    break;

                case 'getBalancesAcrossAllWallets':
                    result = await interfaceInstance.getBalancesAcrossAllWallets();
                    break;

                case 'isTransactionTypeActive':
                    result = await interfaceInstance.isTransactionTypeActive(args.txType);
                    break;

                case 'getAllActiveTransactionTypes':
                    result = await interfaceInstance.getAllActiveTransactionTypes();
                    break;

                case 'getAddressesWithBalanceForProperty':
                    result = await interfaceInstance.getAddressesWithBalanceForProperty(args.propertyId);
                    break;

                case 'getTransaction':
                    result = await interfaceInstance.getTransaction(args.txid);
                    break;

                case 'getProperty':
                    result = await interfaceInstance.getProperty(args.propertyId);
                    break;

                case 'listProperties':
                    result = await interfaceInstance.listProperties();
                    break;

                case 'getGrants':
                    result = await interfaceInstance.getGrants(args.propertyId);
                    break;

                case 'getPayToToken':
                    result = await interfaceInstance.getPayToToken(args.propertyId);
                    break;

                case 'listBlockTransactions':
                    result = await interfaceInstance.listBlockTransactions(args.blockIndex);
                    break;

                case 'listBlocksTransactions':
                    result = await interfaceInstance.listBlocksTransactions(args.firstBlock, args.lastBlock);
                    break;

                case 'listPendingTransactions':
                    result = await interfaceInstance.listPendingTransactions(args.addressFilter);
                    break;

                // ... Add other cases for each method in Interface.js ...

                default:
                    process.send({ error: 'Unknown command' });
            }
        } catch (error) {
            process.send({ error: error.message });
        }
    });
}

module.exports = listen;
