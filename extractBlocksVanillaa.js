const litecoin = require('litecoin');
const fs = require('fs');
const json = require('big-json');
const blockData = [];
var chainHeight = 0
var protocolBlocks = [{ height: 0, omTx: [], tlTx: [] }]
var txIndexomni = []
var indexPlaceholder = 0
var thisBlockOm = []
var thisBlockTl = []
var omniTxCount = 0

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 8332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

function decodeOPReturnPayload(hexPayload) {
    // Decode the payload and return the decoded data
    // ...

    // Example code
    const decodedData = Buffer.from(hexPayload, 'hex').toString('utf8');
    return decodedData;
}

function extractBlockData(startHeight) {
    client.getBlockCount(function (error, chainTip) {
        if (error) {
            console.error('Error retrieving chain tip:', error);
            return;
        } else { chainHeight = chainTip }

        getBlockData(startHeight);
    });
}

function getBlockData(height) {
    console.log(height)
    client.getBlockHash(height, function (error, blockHash) {
        if (error) {
            console.error('Error retrieving block hash:', error);
            return;
        }

        client.getBlock(blockHash, function (error, currentBlock) {
            if (error) {
                console.error('Error retrieving block data:', error);
                return;
            }

            blockData.push(currentBlock);

            if (currentBlock.height === startHeight + 3) {
                console.log('Block data extraction completed.');
                extractProtocolTx(startHeight, false)
            } else {
                getBlockData(height + 1);
            }
        });
    });
}

function makeFile(filename, pojo) {

    const stringifyStream = json.createStringifyStream({
        body: pojo
    });

    stringifyStream.on('data', function (strChunk) {
        fs.appendFile(filename, strChunk, function (err) {
            if (err) throw err;
        })
    });

}

// Example usage
const startHeight = 2098224;
extractBlockData(startHeight);

function extractProtocolTx(start, finishBlock) {
    //console.log(blockData)
    if (finishBlock == true) {
        if (protocolBlocks.omTx != [] || tlTx != []) {
            protocolBlocks.push({ height: start, omTx: thisBlockOm, tlTX: thisBlockTl })
            thisBlockOm = []
            thisBlockTl = []
        }
    }
    indexPlaceholder = start
    var placement = start - startHeight
    console.log(placement, start)
    var thisBlock = blockData[placement]

    if (start >= startHeight + 200000) {
        var obj = JSON.stringify(protocolBlocks)
        makeFile('protocolTxIndex.json', protocolBlocks)
        console.log("ta da!!")
        return true
    }
    loopThroughBlock(thisBlock, 0)
}

function loopThroughBlock(block, i) {
    if (block != undefined) {
        console.log(block.height, i, block.tx.length);
    } else { extractProtocolTx(null, true) }

    if (block === undefined) {
        console.log("Jim, abort! Block undefined");
        return extractProtocolTx(indexPlaceholder + 1, true)
    } else if (i >= block.tx.length) {
        console.log("Jim, abort! i >= tx.length block done!");
        return extractProtocolTx(block.height + 1, true)
    }

    var tx = block.tx[i];

    if (tx === undefined || tx === '') {
        console.log("Jim, abort!");
        return loopThroughBlock(block, i + 1);
    }

    try {
        client.getRawTransaction(tx, true, function (err, rawtx) {

            if (err && err.code === -5) {
                // "No such mempool transaction" error, skip this transaction
                console.error("Skipping transaction:", tx, "Error:", err.message);
                return loopThroughBlock(block, i + 1);
            } else if (err) {
                // Handle other errors as needed
                console.error("Error processing transaction:", err);
                return loopThroughBlock(block, i + 1);
            }

            // Process the transaction as normal

            let confirmations;
            try {
                confirmations = rawtx.confirmations;
            } catch {
                return loopThroughBlock(block, i + 1);
            }

            var thisConfirmations = confirmations;

            for (let v = 0; v < rawtx.vout.length; v++) {
                // ... Rest of your code
            }

            // Move to the next transaction
            loopThroughBlock(block, i + 1);
        });
    } catch (error) {
        console.error("Error processing transaction:", error);
        // Handle the error gracefully if necessary
        loopThroughBlock(block, i + 1);
    }
}

function decodeOmniPayload(hexPayload) {
    const marker = hexPayload.slice(0, 4);

    if (marker === '6f6d') {
        // Decode 'om' marker
        return "omni"
    } else if (marker === '746c') {
        // Decode 'tl' marker
        return "tl"
    } else {
        // Unknown marker
        return { error: 'Unknown marker' };
    }
}
