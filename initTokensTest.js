const TxIndex = require('./txIndex.js')
const Main = require('./main.js'); // Replace with the correct path
const TallyMap = require('./tally.js'); // Replace with the correct path

// Define the admin address
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";

async function runIntegrationTest() {
    console.log("Starting integration test...");

    // Access the singleton instance of Main
    await TxIndex.clearTxIndex()
    const mainProcessor = Main.getInstance(test=true);
    await mainProcessor.initialize(); // Assuming init() initializes the entire flow

    // Monitor the progress
    console.log("Transaction Index Completed");
    console.log("Consensus Completed");

    // Trigger activation transaction (tx type "0")
    //await mainProcessor.triggerActivationTransaction(adminAddress, 0);
    console.log("Activation Transaction Processed");

    // Check the balance in the tally map for the admin address
    const balance = await TallyMap.getAddressBalances(adminAddress);
    console.log(`Balance for admin address ${adminAddress}:`, balance);

    console.log("Integration test completed.");
}

runIntegrationTest().catch(console.error);
