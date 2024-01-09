const Litecoin = require('litecoin');
const util = require('util');

const config = {
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
};

const client = new Litecoin.Client(config);

// Promisify the cmd function to make it async
const cmdAsync = util.promisify(client.cmd.bind(client));

// Function to generate a new Litecoin address using cmd
async function generateNewAddress() {
    try {
        return await cmdAsync('getnewaddress');
    } catch (error) {
        console.error('Error generating new address:', error.message);
        throw error;
    }
}

// Example usage
async function main() {
    try {
        // Generate a new Litecoin address
        const newAddress = await generateNewAddress();
        console.log('New Litecoin Address:', newAddress);

        // Send 20 tokens to the new address from the admin address
        //await sendTokensToAddress(newAddress, 20);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run the main function
main();