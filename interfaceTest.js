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
    const properties = await expressInterface.listProperties();
    console.log('Properties:', properties);
    const activations = await expressInterface.getActivations()
    console.log('Activations:', activations)


}

runTest();
