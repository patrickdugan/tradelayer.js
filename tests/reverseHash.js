const axios = require('axios');
const crypto = require('crypto');

// Litecoin Core RPC Configuration
const rpcConfig = {
    url: 'http://127.0.0.1:18332', // Default Litecoin RPC port for testnet is 19332
    auth: {
        username: 'user', // Replace with your Litecoin RPC username
        password: 'pass'  // Replace with your Litecoin RPC password
    }
};

// Function to make RPC calls
async function callRpc(method, params = []) {
    try {
        const response = await axios.post(rpcConfig.url, {
            jsonrpc: '1.0',
            id: 'curltext',
            method,
            params
        }, { auth: rpcConfig.auth });
        return response.data.result;
    } catch (error) {
        console.error(`RPC call error: ${error.message}`);
        return null;
    }
}

// Function to compute double SHA-256 hash and derive txid
function doubleSHA256(buffer) {
    const hash1 = crypto.createHash('sha256').update(buffer).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    return hash2;
}

// Function to reverse byte order for display
function reverseBytes(buffer) {
    return Buffer.from(buffer).reverse();
}

// Function to get txid from raw hex
function getTxidFromRawHex(rawHex) {
    const rawBuffer = Buffer.from(rawHex, 'hex');
    const hash = doubleSHA256(rawBuffer);
    return reverseBytes(hash).toString('hex');
}

// Main function to fetch, decode, and validate transaction
async function fetchAndDecodeTransaction(txid) {
    // Fetch raw transaction hex
    const rawHex = await callRpc('getrawtransaction', [txid, false]);
    if (!rawHex) {
        console.error('Failed to fetch raw transaction hex.');
        return;
    }

    // Calculate txid from raw hex
    const calculatedTxid = getTxidFromRawHex(rawHex);
    console.log(`Calculated Txid: ${calculatedTxid}`);

    // Decode raw transaction
    const decodedTx = await callRpc('decoderawtransaction', [rawHex]);
    if (decodedTx) {
        console.log('Decoded Transaction:', JSON.stringify(decodedTx, null, 2));
    } else {
        console.error('Failed to decode transaction.');
    }
}

// Example usage
const exampleTxid = 'your_transaction_id_here'; // Replace with a valid transaction ID
fetchAndDecodeTransaction(exampleTxid);
