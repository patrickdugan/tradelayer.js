const Litecoin = require('litecoin'); // Replace with actual library import
const util = require('util');
const bitcore = require('bitcore-lib-ltc');

const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const STANDARD_FEE = 10000; // Standard fee in LTC
const DUST_THRESHOLD = 54600; // Dust threshold in LTC

const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const getrawtransactionAsync = util.promisify(client.cmd.bind(client, 'getrawtransaction'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client, 'sendrawtransaction'));
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'))

const scriptPubKey= "0014ebecd536259ef21bc6ecc18e45b35412f0472290"

async function main() {

        // Dump private key
        const privateKey = await dumpprivkeyAsync('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');
        console.log(privateKey);

        // Get raw transaction
        const rawTx = await getrawtransactionAsync('57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5');
        console.log(rawTx);

        // Extract scriptPubKey
        const scriptPubKey = await getScriptPubKeyFromRawTx(rawTx, 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8', 1);
        console.log(scriptPubKey);

        // Create UTXO object
        var utxo = {
            "txId": "57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5",
            "outputIndex": 1,
            "address": "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8",
            "script": scriptPubKey,
            "satoshis": 50000 // This should be the actual amount in satoshis
        };

        // Get the UTXO from the blockchain (I assume you have the txid and vout)
        const utxoTxId = '57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5';
        const utxoVout = 1; // or the appropriate vout index

        const blockchainUtxo = await getrawtransactionAsync(utxoTxId, true);
        const blockchainScriptPubKey = blockchainUtxo.vout[utxoVout].scriptPubKey.hex;

        // Compare with the script you have in your UTXO object
        if (utxo.script !== blockchainScriptPubKey) {
            console.error("Script mismatch: UTXO script does not match blockchain data.");
        }

        // Check if the UTXO is unspent
        const utxos = await listUnspentAsync(0, 9999999, ["tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"]);

        let utxoFound = false;
        utxos.forEach(utxo => {
            if (utxo.txid === utxoTxId && utxo.vout === utxoVout) {
                utxoFound = true;
                // Validate the satoshis (amount in satoshis) as well
                if (utxo.satoshis !== 50000) { // Replace 50000 with the correct amount
                    console.error("Incorrect UTXO amount.");
                }
            }
        });

        if (!utxoFound) {
            console.error("UTXO not found or already spent.");
        }

        try {
            // Create and sign transaction
            var transaction = new bitcore.Transaction()
                .from(utxo) // Make sure this UTXO is unspent
                .addData('litecore rocks') // OP_RETURN data
                .change('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8') // Change address
                .sign(privateKey);

            // Check if transaction is valid before serialization
            if (transaction.getSerializationError()) {
                const error = transaction.getSerializationError().message;
                throw new Error(`Transaction serialization failed: ${error}`);
            }

            const serializedTx = transaction.serialize();
            console.log(`Serialized Transaction: ${serializedTx}`);

            // Broadcast the transaction
            const txid = await sendrawtransactionAsync(serializedTx);
            console.log(`Transaction ID: ${txid}`);
        } catch (error) {
            console.error(`Error:`, error);
        }
}

// Execute the main function
main();

async function getScriptPubKeyFromRawTx(rawTx, address, vout) {
    try {
        // Decode the raw transaction
        const decodedTx = await decoderawtransactionAsync(rawTx);

        // Find the output with the matching address
        return decodedTx.vout[vout].scriptPubKey.hex;
    } catch (error) {
        console.error(`Error retrieving scriptPubKey:`, error);
        throw error;
    }
}
