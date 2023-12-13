const TallyMap = require('./tally.js'); // Adjust the path to your TallyMap class file

async function displayTallyMap() {
    try {
        console.log('Loading TallyMap from Database...');

        // Assuming the block height is not relevant for just loading and displaying
        const tallyMapInstance = await TallyMap.getInstance(); 
        tallyMapInstance.loadFromDB()
        // Convert the Map to an Object for easier JSON stringification
        const tallyMapObject = Object.fromEntries(tallyMapInstance.addresses);
        console.log('tallyMap: '+JSON.stringify(tallyMapInstance.addresses))
        console.log('TallyMap:', JSON.stringify(tallyMapObject, null, 2));
    } catch (error) {
        console.error('Error loading and displaying TallyMap:', error);
    }
}

displayTallyMap();
