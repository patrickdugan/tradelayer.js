const Datastore = require('nedb');
const path = require('path');
const util = require('util');
const txIndex = require('./txIndex.js'); // Ensure this is the correct path to your TxIndex class
const dbInstance = require('./db.js'); // Import the dbInstance from your db.js file

async function updateMaxHeight(chainTip) {
    try {
        const txIndexDB = dbInstance.getDatabase('txIndex'); // Retrieve the txIndex database using dbInstance
        console.log(`Updating MaxHeight to ${chainTip}`);
        await txIndexDB.updateAsync(
            { _id: 'MaxHeight' },
            { _id: 'MaxHeight', value: chainTip },
            { upsert: true }
        );
        console.log('MaxHeight updated successfully.');
    } catch (error) {
        console.error('Error updating MaxHeight:', error);
        throw error;
    }
}

async function fetchMaxHeight() {
    try {
        const txIndexDB = dbInstance.getDatabase('txIndex'); // Retrieve the txIndex database using dbInstance
        const maxHeightDoc = await txIndexDB.findOneAsync({ _id: 'MaxHeight' });
        if (maxHeightDoc) {
            console.log(`MaxHeight fetched from DB: ${maxHeightDoc.value}`);
        } else {
            console.log('MaxHeight not found in DB.');
        }
    } catch (error) {
        console.error('Error fetching MaxHeight:', error);
        throw error;
    }
}

async function runTest() {
    try {
        const chainTip = await txIndex.getInstance().fetchChainTip(); // Ensure this is the correct way to get chainTip
        await updateMaxHeight(chainTip);
        await fetchMaxHeight();
        console.log('Test completed successfully');
    } catch (error) {
        console.error('Test failed:', error);
    }
}

runTest();
