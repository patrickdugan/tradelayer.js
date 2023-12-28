const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
    }

const expressInterface = require('./interfaceExpress.js');

async function runTest() {
    await expressInterface.initMain();
           await delay(5000)
    const balance2 = await expressInterface.getAllBalancesForAddress('tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk');
     console.log(`Balance for tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk:`, balance2);
    
    // New calls
    const contractSeries = await expressInterface.listContractSeries();
    console.log('Contract Series:', contractSeries);

    const oracles = await expressInterface.listOracles();
    console.log('Oracles:', oracles);

     // Load order books
    const orderBook1 = await expressInterface.getContractOrderBook(1);
    console.log('Order Book for Contract ID 1:', orderBook1);

    const trades = await expressInterface.getContractTradeHistory(1)
    console.log('trade history '+trades)

}

runTest();
