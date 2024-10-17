const axios = require('axios');
const baseConverter = require('bigint-base-converter');
let txCount = 0

// Litecoin Core RPC Config
const rpcConfig = {
    url: 'http://127.0.0.1:18332',
    auth: {
        username: 'user', // Replace with your Litecoin Core RPC username
        password: 'pass'  // Replace with your Litecoin Core RPC password
    }
};

// Base 94 and Base 128 Character Sets
const base94Chars = [...Array(94).keys()].map(i => String.fromCharCode(i + 33));
const base128Chars = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i + 128));

// Define Custom Character Set, Filtering Out Problematic Characters
const allCharacters = [...Array(65536).keys()].map(i => String.fromCharCode(i));
const customBase256Chars = allCharacters.filter(
    char => !/[\s\u0000-\u001F\u007F-\u00A0\u00AD\u2028\u2029]/.test(char)
).slice(0, 256);

// Check if the character set meets the base requirements
if (customBase256Chars.length !== 256) {
    console.warn(`Character set only contains ${customBase256Chars.length} characters, switching to smaller base.`);
}

// Encoding Functions
function hexToBase94(hex) {
    const decimalString = BigInt(`0x${hex}`).toString(10);
    return baseConverter(decimalString, 10, base94Chars.join(''));
}

function hexToBase128(hex) {
    const decimalString = BigInt(`0x${hex}`).toString(10);
    return baseConverter(decimalString, 10, base128Chars.join(''));
}

function hexToCustomBase256(hex) {
    const decimalString = BigInt(`0x${hex}`).toString(10);
    return baseConverter(decimalString, 10, customBase256Chars.join(''));
}

function fromCustomBase256(base256String) {
    const result = baseConverter(base256String, customBase256Chars.join(''), 10);
    return Array.isArray(result) ? result.join('') : result;
}

// Helper to Detect Problematic Characters
function hasWhitespaceOrNonPrintable(str) {
    return /[\s\u0000-\u001F\u007F-\u00A0\u00AD\u2028\u2029]/.test(str);  // Common problematic characters
}

// Main Function to Test Encodings
async function testTxidEncodings(startBlock, endBlock) {
    const results = {
        base94: { lengths: [], problematicCount: 0 },
        base128: { lengths: [], problematicCount: 0 },
        customBase256: { lengths: [], problematicCount: 0 }
    };

    for (let block = startBlock; block <= endBlock; block++) {
        if(block%1000==1){console.log(block)}
        try {
            // Fetch Block Hash and Block Data
            const { data: blockHashRes } = await axios.post(rpcConfig.url, {
                jsonrpc: '1.0',
                id: 'curltext',
                method: 'getblockhash',
                params: [block]
            }, { auth: rpcConfig.auth });
            const blockHash = blockHashRes.result;

            const { data: blockRes } = await axios.post(rpcConfig.url, {
                jsonrpc: '1.0',
                id: 'curltext',
                method: 'getblock',
                params: [blockHash, 2]
            }, { auth: rpcConfig.auth });

            const transactions = blockRes.result.tx;
            transactions.forEach(tx => {
                const txid = tx.txid;
                txCount++
                // Base 94 Encoding
                const base94Encoded = hexToBase94(txid);
                results.base94.lengths.push(base94Encoded.length);
                if (hasWhitespaceOrNonPrintable(base94Encoded)) {
                    results.base94.problematicCount++;
                }
                
                // Base 128 Encoding
                const base128Encoded = hexToBase128(txid);
                results.base128.lengths.push(base128Encoded.length);
                if (hasWhitespaceOrNonPrintable(base128Encoded)) {
                    results.base128.problematicCount++;
                }
                
                // Custom Base 256 Encoding
                const customBase256Encoded = hexToCustomBase256(txid);
                results.customBase256.lengths.push(customBase256Encoded.length);
                if (hasWhitespaceOrNonPrintable(customBase256Encoded)) {
                    results.customBase256.problematicCount++;
                }
            });
        } catch (error) {
            console.error(`Error processing block ${block}:`, error.message);
        }
    }

    // Output Statistical Results
    const avgLength = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log('--- Base 94 Results ---');
    console.log(`Average Length: ${avgLength(results.base94.lengths)}`);
    console.log(`Problematic Character Count: ${results.base94.problematicCount}`);

    console.log('--- Base 128 Results ---');
    console.log(`Average Length: ${avgLength(results.base128.lengths)}`);
    console.log(`Problematic Character Count: ${results.base128.problematicCount}`);

    console.log('--- Custom Base 256 Results ---');
    console.log(`Average Length: ${avgLength(results.customBase256.lengths)}`);
    console.log(`Problematic Character Count: ${results.customBase256.problematicCount}`);
    console.log('Total transactions '+txCount)
}

// Run Test on Blocks 100000 to 100010 (sample range)
testTxidEncodings(3100000, 3150010);
