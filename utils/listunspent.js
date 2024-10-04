const async = require('async');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const litecoin = require('litecoin');

// Litecoin client configuration (make sure your daemon is running and the RPC parameters are correct)
const clientConfig = {
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
};

const client = new litecoin.Client(clientConfig);

// Promisify client functions for `listunspent` and `getaddressesbylabel`
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const getAddressesByLabelAsync = util.promisify(client.cmd.bind(client, 'getaddressesbylabel'));
const getListReceivedByAddressAsync = util.promisify(client.cmd.bind(client, 'listreceivedbyaddress'))
const getMempool = util.promisify(client.cmd.bind(client, 'getrawmempool'))
// Fetch UTXOs for all addresses in the wallet
async function listUnspentForAllAddresses() {

    const allAddresses = await getListReceivedByAddressAsync(0, true)

        console.log('all addresses '+JSON.stringify(allAddresses))

    try {
        // Fetch all wallet addresses with a label (e.g., "" means all addresses)
        const label = "tl-wallet"; // Empty string means fetch all addresses
        const addressesByLabel = await getAddressesByLabelAsync(label);
        

        const addresses = Object.keys(addressesByLabel);

        if (addresses.length === 0) {
            console.log('No addresses found in the wallet.');
            return;
        }

        console.log(`Found ${addresses.length} addresses in the wallet.`);

        // Loop over each address and fetch its UTXOs
        for (let address of addresses) {
            console.log(`Fetching UTXOs for address: ${address}`);
            
            const minConfirmations = 1;
            const maxConfirmations = 9999999;
            const utxos = await listUnspentAsync(minConfirmations, maxConfirmations, [address]);

            if (utxos && utxos.length > 0) {
                console.log(`UTXOs for ${address}:`, utxos);
            } else {
                console.log(`No UTXOs available for address: ${address}`);
            }
        }
        const mempool = await getMempool(true)
        console.log('checking mempool '+JSON.stringify(mempool))
    } catch (error) {
        console.error('Error fetching addresses or UTXOs:', error);
    }
}

// Execute the function to list unspent outputs for all addresses in the wallet
listUnspentForAllAddresses();
