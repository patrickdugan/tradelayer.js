const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";

// ---- HARD INTERCEPTS ----
const origLog = console.log;
const origErr = console.error;
const origExit = process.exit;

console.log = (...args) => {
    if (args.includes('Error:')) {
        console.trace('TRACE console.log Error:');
    }
    origLog(...args);
};

console.error = (...args) => {
    if (args.includes('Error:')) {
        console.trace('TRACE console.error Error:');
    }
    origErr(...args);
};

process.exit = (code) => {
    console.trace('TRACE process.exit', code);
    origExit(code);
};

process.on('unhandledRejection', err => {
    console.error('UNHANDLED REJECTION:', err);
    console.trace();
});

process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION:', err);
    console.trace();
});


const originalLog = console.log;
console.log = (...args) => {
    if (args.length === 1 && args[0] === 'Error:') {
        console.trace('TRACE FOR swallowed Error:');
    }
    originalLog(...args);
};


async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
    }

const expressInterface = require('../src/walletInterface.js');

async function runTest() {
    await expressInterface.initMain();
           await delay(1000)

    /*const address = 'tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk';
    const contractId = 1; // example contract ID

    const balance2 = await expressInterface.getAllBalancesForAddress('tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk');
     console.log(`Balance for tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk:`, balance2);

     const balance3 = await expressInterface.getAllBalancesForAddress('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');
     console.log(`Balance for tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8:`, balance3);
    
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
    console.log('trade history '+trades)
    */


}

runTest().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
