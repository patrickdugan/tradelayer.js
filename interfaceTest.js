const InterfaceChild = require('./InterfaceChild');
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"; // Replace with your admin address

async function testInterfaceChild() {
    try {
        const tradeLayerInterfaceChild = new InterfaceChild();

        // Start the main process (handled within the InterfaceChild constructor)
        console.log("Main process started.");

        // Query for balance on the admin address
        const adminBalance = await tradeLayerInterfaceChild.getAllBalancesForAddress(adminAddress);
        console.log(`Balance for admin address (${adminAddress}):`, adminBalance);

        // Query for the property list
        const propertyList = await tradeLayerInterfaceChild.listProperties();
        console.log("Property List:", propertyList);

        // ... additional queries as needed ...

    } catch (error) {
        console.error("Error during test:", error);
    }
}

testInterfaceChild();
