const MainClass = require('./main.js'); // Replace with the correct path
const TallyMap = require('./tally.js'); // Replace with the correct path

// Define the admin address
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";

async function runIntegrationTest() {
    console.log("Starting integration test...");

    // Initialize the Main class
    const mainProcessor = new MainClass();
    await mainProcessor.init(); // Assuming init() initializes the entire flow

    // Monitor the progress
    // Note: The console logs within the Main class should be added directly in the class methods
    console.log("Transaction Index Completed");
    console.log("Consensus Completed");

    // Trigger activation transaction (tx type "0")
    // Note: This part depends on how your system handles transactions
    await mainProcessor.triggerActivationTransaction(adminAddress, 0);

    console.log("Activation Transaction Processed");

    // Check the balance in the tally map for the admin address
    const balance = await TallyMap.getAddressBalances(adminAddress);
    console.log(`Balance for admin address ${adminAddress}:`, balance);

    console.log("Integration test completed.");
}

runIntegrationTest().catch(console.error);
