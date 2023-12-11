const Litecoin = require('litecoin'); // Replace with your actual library import
const util = require('util');

// Configure your Litecoin client
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

// Promisify the getRawTransaction function
const getRawTransactionAsync = util.promisify(client.getRawTransaction.bind(client));

// List of txids to test
const txids = [
    '5b0b0c97398dfcfc62c41f80c4f1c64d5220bd3a9e99d3a68a1ed514b93c6ab0',
    'e2c24ba7e7694cfdc3895e5690ab13b7a8dd8f061ae91fd6e58d896a6cf74737',
    '3a9c8d7ddb4432f36d6d3d858354fa22acbee9e95bb512dc097ffb456c0d357a',
    '19709105715a195f03cdb05cedb38b14f8d215418dc2ef416e083b40021e6fee'

    // Add more txids here for testing
];

// Function to test getRawTransaction for each txid
async function testGetRawTransaction() {
    for (const txid of txids) {
        try {
            console.log(`Fetching transaction for txid: ${txid}`);
            const transaction = await getRawTransactionAsync(txid, true);
            console.log(`Transaction:`, transaction);
        } catch (error) {
            console.error(`Error fetching transaction for txid ${txid}:`, error);
        }
    }
}

// Run the test
testGetRawTransaction();
