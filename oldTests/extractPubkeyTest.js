const Litecoin = require('litecoin');
const util = require('util');
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

// Promisify the necessary RPC commands
const getrawtransactionAsync = util.promisify(client.cmd.bind(client, 'getrawtransaction'));
const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));

async function getScriptPubKeyFromRawTx(rawTx, address) {
    try {
        // Decode the raw transaction
        const decodedTx = await decoderawtransactionAsync('decoderawtransaction', rawTx);

        // Find the output with the matching address
        const matchingOutput = decodedTx.vout.find(output => 
            output.scriptPubKey.addresses && output.scriptPubKey.addresses.includes(address));

        if (matchingOutput) {
            console.log(`ScriptPubKey for address ${address}:`, matchingOutput.scriptPubKey.hex);
            return matchingOutput.scriptPubKey.hex;
        } else {
            throw new Error(`Address not found in transaction outputs`);
        }
    } catch (error) {
        console.error(`Error retrieving scriptPubKey:`, error);
        throw error;
    }
}

async function getAndDecodeRawTransaction(txid) {
    try {
        // Retrieve the raw transaction hex string using the transaction ID
        const rawTx = await getrawtransactionAsync(txid);
        console.log(`Raw Transaction Hex: ${rawTx}`);

        // Decode the raw transaction
        const decodedTx = await decoderawtransactionAsync('decoderawtransaction', rawTx);
        console.log('Decoded Transaction:', decodedTx);

        // Get the scriptPubKey for a specific address
        await getScriptPubKeyFromRawTx(rawTx, 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');

        return decodedTx;
    } catch (error) {
        console.error(`Error retrieving and decoding raw transaction:`, error);
        throw error;
    }
}

// Example usage
const txid = '57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5';
getAndDecodeRawTransaction(txid)
    .then(decodedTx => console.log(`Decoded Transaction:`, decodedTx))
    .catch(error => console.error(`Error: ${error.message}`));
