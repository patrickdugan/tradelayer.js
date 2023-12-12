const TallyMap = require('./tally');
const TxIndex = require('./TxIndex');
const PropertyManager = require('./property');
// ... Import other necessary modules ...

async function listen() {
    process.on('message', async (message) => {
        try {
            const { command, args } = message;
            switch (command) {
                case 'getAllBalancesForAddress':
                    const balances = await TallyMap.getAddressBalances(args.address);
                    process.send({ data: balances });
                    break;

                case 'getTransaction':
                    const transaction = await TxIndex.getTransactionDetails(args.txid);
                    process.send({ data: transaction });
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
