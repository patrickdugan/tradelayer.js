const TallyMap = require('./tally.js'); // Adjust the path

async function runUnitTest() {
    console.log('Starting TallyMap Unit Test');

    // Step 1: Initialize TallyMap
    const blockHeight = 100; // Example block height
    const tallyMap = await TallyMap.getInstance(blockHeight);

    // Step 2: Update TallyMap
    const address = 'test-address';
    const propertyId = '1';
    const amountChange = 100;
    const availableChange = 50;
    const reservedChange = 30;
    const vestingChange = 20;

    try {
        await TallyMap.updateBalance(address, propertyId, amountChange, availableChange, reservedChange, vestingChange);
        console.log('Balance updated successfully');
    } catch (error) {
        console.error('Error updating balance:', error);
    }

    // Step 3: Output Serialized TallyMap
    const serializedTallyMap = JSON.stringify([...tallyMap.addresses]);
    console.log('Serialized TallyMap:', serializedTallyMap);

    // Extra Credit: Save to DB
    try {
        await tallyMap.saveToDB();
        console.log('TallyMap saved to DB successfully');
    } catch (error) {
        console.error('Error saving TallyMap to DB:', error);
    }
}

runUnitTest();
