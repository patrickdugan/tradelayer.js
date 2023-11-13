const litecoin = require('litecoin');
const fs = require('fs');
const json = require('big-json');

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 8332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

async function decodeOPReturnPayload(hexPayload) {
    try {
        const decodedData = Buffer.from(hexPayload, 'hex').toString('utf8');
        return decodedData;
    } catch (error) {
        console.error('Error decoding payload:', error);
        return null;
    }
}

async function extractBlockData(startHeight) {
    try {
        const chainTip = await client.getBlockCount();
        const chainHeight = chainTip;

        const blockData = await getBlockData(startHeight, chainHeight);

        if (blockData) {
            console.log('Block data extraction completed.');
            await extractProtocolTx(startHeight, blockData);
        }
    } catch (error) {
        console.error('Error retrieving chain tip:', error);
    }
}

async function getBlockData(height, chainHeight) {
    try {
        const blockHash = await client.getBlockHash(height);
        const currentBlock = await client.getBlock(blockHash);

        return currentBlock;
    } catch (error) {
        console.error('Error retrieving block data:', error);
        return null;
    }
}

async function makeFile(filename, pojo) {
    const stringifyStream = json.createStringifyStream({
        body: pojo
    });

    stringifyStream.on('data', function (strChunk) {
        fs.appendFile(filename, strChunk, function (err) {
            if (err) {
                console.error('Error writing to file:', err);
            }
        });
    });
}

async function extractProtocolTx(start, blockData) {
    if (!blockData) {
        console.error('Invalid block data. Aborting.');
        return;
    }

    const indexPlaceholder = start;
    const placement = start - startHeight;
    console.log(placement, start);

    const thisBlock = blockData[placement];

    if (start >= startHeight + 200000) {
        const obj = JSON.stringify(protocolBlocks);
        await makeFile('protocolTxIndex.json', protocolBlocks);
        console.log('ta da!!');
        return;
    }

    await loopThroughBlock(thisBlock, 0);
}

async function loopThroughBlock(block, i) {
    if (!block) {
        console.error('Block is undefined. Aborting.');
        return;
    }

    console.log(block.height, i, block.tx.length);

    if (i >= block.tx.length) {
        console.log('Block processing completed.');
        await extractProtocolTx(block.height + 1, blockData);
        return;
    }

    const tx = block.tx[i];

    if (!tx || tx === '') {
        console.log('Skipping empty transaction.');
        await loopThroughBlock(block, i + 1);
        return;
    }

    try {
        const rawtx = await client.getRawTransaction(tx, true);
        let confirmations;

        try {
            confirmations = rawtx.confirmations;
        } catch {
            console.error('Error getting confirmations.');
            return await loopThroughBlock(block, i + 1);
        }

        const thisConfirmations = confirmations;

        for (let v = 0; v < rawtx.vout.length; v++) {
            // ... Rest of your code
        }

        // Move to the next transaction
        await loopThroughBlock(block, i + 1);
    } catch (error) {
        console.error('Error processing transaction:', error);
        // Handle the error gracefully if necessary
        await loopThroughBlock(block, i + 1);
    }
}

async function main() {
    const startHeight = 2098224;
    await extractBlockData(startHeight);
}

main();
