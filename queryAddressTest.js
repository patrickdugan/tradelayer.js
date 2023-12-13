const TallyMap = require('./tally.js'); // Adjust the path

async function queryAddressBalances(address) {
    try {
        console.log(`Querying balances for address: ${address}`);
        //const tallyMapInstance = await TallyMap.getInstance();
        //await tallyMapInstance.loadFromDB();

        const balances = await TallyMap.getAddressBalances(address);
        console.log(`Balances for address ${address}:`, balances);
    } catch (error) {
        console.error('Error querying address balances:', error);
    }
}

const addressToQuery = 'test-address' //'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';
queryAddressBalances(addressToQuery);
