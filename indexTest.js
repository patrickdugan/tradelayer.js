const TxIndex = require('./txIndex.js');

async function runUnitTest() {
    const txIndex = new TxIndex();
    const genesisBlock = 3082500;

    try {
        console.log(`Initializing index from genesis block: ${genesisBlock}`);
        await txIndex.initializeIndex(genesisBlock);
        
        console.log(`Extracting block data starting from block: ${genesisBlock}`);
        await txIndex.extractBlockData(genesisBlock);

        //console.log(`Indexing complete. Checking for 'tl00' payload...`);
        // Check for 'tl00' payload in the transparentIndex
        if (txIndex.transparentIndex.includes('00')) {
            console.log("Payload 'tl00' found in the index.");
        } else {
            console.log("Payload 'tl00' not found in the index.");
        }

        // Optionally, you can also load the index from LevelDB and check its contents
        const loadedIndex = await txIndex.loadIndex();
        console.log('Loaded index:', loadedIndex);

    } catch (error) {
        console.error('Error during unit test:', error);
    }
}

runUnitTest();
