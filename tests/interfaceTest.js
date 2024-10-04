const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
    }

const expressInterface = require('./interfaceExpress.js');

async function runTest() {
    await expressInterface.initMain();
           await delay(2000)
    const balance = await expressInterface.getAllBalancesForAddress(adminAddress);
    console.log(`Balance for ${adminAddress}:`, balance);
    const balance2 = await expressInterface.getAllBalancesForAddress('LNmiS6p8z3KuHHx3q6Jf6x6TfcyptE68oP');
     console.log(`Balance for LNmiS6p8z3KuHHx3q6Jf6x6TfcyptE68oP:`, balance2);
    const properties = await expressInterface.listProperties();
    console.log('Properties:', properties);
    const activations = await expressInterface.getActivations()
    console.log('Activations:', activations)

    // Load order books
    const orderBook34 = await expressInterface.getOrderBook(3, 4);
    console.log('Order Book for Property IDs 3 and 4:', orderBook34);
    const orderBook43 = await expressInterface.getOrderBook(4, 3);
    console.log('Order Book for Property IDs 4 and 3:', orderBook43);

    
    // New calls
    const contractSeries = await expressInterface.listContractSeries();
    console.log('Contract Series:', contractSeries);

    const oracles = await expressInterface.listOracles();
    console.log('Oracles:', oracles);

}

runTest();
