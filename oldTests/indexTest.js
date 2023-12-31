const TxIndex = require('./txIndex.js');

async function runUnitTest() {
    const genesisBlock = 3082500;
    try {
        console.log(`Initializing index from genesis block: ${genesisBlock}`);
        await TxIndex.initializeIndex(genesisBlock,true);
    
        console.log(`Extracting block data starting from block: ${genesisBlock}`);
        await TxIndex.extractBlockData(genesisBlock);

        if (txIndex.transparentIndex.includes('00')) {
            console.log("Payload 'tl00' found in the index.");
        } else {
            console.log("Payload 'tl00' not found in the index.");
        }

        const loadedIndex = await TxIndex.loadIndex(); // Corrected to call static method
        console.log('Loaded index:', loadedIndex);

    } catch (error) {
        console.error('Error during unit test:', error);
    }
}

runUnitTest();
