
const Interface = require('./Interface');
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"; // Replace with your admin address

async function testInterface() {
    try {
        const tradeLayerInterface = new Interface();

        // Start the main process (handled within the Interface constructor)
        console.log("Main process started.");

        // Query for balance on the admin address
        const adminBalance = await tradeLayerInterface.getAllBalancesForAddress(adminAddress);
        console.log(`Balance for admin address (${adminAddress}):`, adminBalance);

        // Query for the property list
        const propertyList = await tradeLayerInterface.listProperties();
        console.log("Property List:", propertyList);

        // Query for the activations list
        const activationsList = await tradeLayerInterface.listActivations();
        console.log("Activations List:", activationsList);

        // ... additional queries as needed ...

    } catch (error) {
        console.error("Error during test:", error);
    }
}

testInterface();
