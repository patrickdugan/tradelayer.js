// testGetRawTransaction.js
const Litecoin = require('litecoin');
const util = require('util');

// Configuration for Litecoin RPC
const config = {
    host: '127.0.0.1',
    port: 18332,
    user: 'user', // replace with actual RPC username
    pass: 'pass', // replace with actual RPC password
    timeout: 10000,
};

// Create Litecoin client instance
const client = new Litecoin.Client(config);

// Promisify getrawtransaction
const getRawTransaction = (txId, verbose = true) => {
    return util.promisify(client.cmd.bind(client, 'getrawtransaction'))(txId, verbose);
};

// Test transaction ID (replace with a valid txId)
const testTxId = '763db4ffd18c7c0839b8e7532907db2b48e10da5c08b28874c249aa870a505aa';

(async () => {
    try {
        const transactionData = await getRawTransaction(testTxId, true);
        console.log('Transaction Data:', transactionData);
    } catch (error) {
        console.error('Error retrieving transaction:', error);
    }
})();
