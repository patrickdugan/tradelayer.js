const InterfaceChild = require('./interfaceChild.js');
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"; // Replace with your admin address

async function testInterfaceChild() {
    try {

    	const interfaceChild = new InterfaceChild();
		interfaceChild.initMain().then(() => {
		    console.log("initMain command sent.");
		}).catch((error) => {
		    console.error("Error sending initMain command:", error);
		});

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
