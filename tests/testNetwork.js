const litecoin = require('litecoin');
const util = require('util');

// Litecoin client configuration
const clientConfig = {
    host: '127.0.0.1', // Change to your Litecoin node IP if needed
    port: 18332,        // Default Litecoin RPC port
    user: 'user', // Set your RPC username
    pass: 'pass', // Set your RPC password
    timeout: 10000
};

// Create a Litecoin client
const client = new litecoin.Client(clientConfig);

// Promisify the RPC call for getnetworkinfo
const getNetworkInfoAsync = util.promisify(client.cmd.bind(client, 'getnetworkinfo'));

async function testNetworkInfo() {
    try {
        const result = await getNetworkInfoAsync();
        console.log('Network Info:', result); // Log the network info if successful
    } catch (error) {
        if (error.code === -32601) {
            console.error('Error: Method not found. Ensure that your Litecoin node supports the getnetworkinfo method.');
        } else {
            console.error('An unexpected error occurred:', error);
        }
    }
}

// Call the test function
testNetworkInfo();
