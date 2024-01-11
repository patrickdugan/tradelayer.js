const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const expressInterface = require('./interfaceExpress.js');

async function runTest() {
    await expressInterface.initMain();
    await delay(3000)

    const address = 'tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk';
    const contractId = 1; // example contract ID

    const balance2 = await expressInterface.getAllBalancesForAddress('tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk');
    console.log(`Balance for tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk:`, balance2);

    // New calls
    const contractSeries = await expressInterface.listContractSeries();
    console.log('Contract Series:', contractSeries);

    const oracles = await expressInterface.listOracles();
    console.log('Oracles:', oracles);

    // Get contract position for the address
    const contractPosition = await expressInterface.getContractPositionForAddressAndContractId(address, contractId);
    console.log(`Contract Position for Address ${address} and Contract ID ${contractId}:`, contractPosition);

    // Get trade history for the contract
    const contractTradeHistory = await expressInterface.getContractTradeHistory(contractId);
    console.log(`Trade History for Contract ID ${contractId}:`, contractTradeHistory);

    // Load order books
    const orderBook1 = await expressInterface.getContractOrderBook(1);
    console.log('Order Book for Contract ID 1:', orderBook1);

    const trades = await expressInterface.getContractTradeHistory(1)
    console.log('trade history ' + trades)



}

runTest();
