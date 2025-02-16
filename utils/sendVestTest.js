const litecoin = require('litecoin');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const TxUtils = require('../src/txUtils.js');

const clientConfig = {
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
};

const client = new litecoin.Client(clientConfig);

const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const dumpPrivKeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client, 'sendrawtransaction'));

// Function to dump the private key and fetch the biggest unspent output
async function prepareTransactionParams(address) {
    try {
        // Dump the private key of the given address
        const privateKey = await dumpPrivKeyAsync(address);
        console.log('Private Key:', privateKey);

        // List all unspent outputs
        const unspentOutputs = await listUnspentAsync(0, 9999999, [address]);

        if (!unspentOutputs.length) {
            throw new Error('No unspent outputs available for the address.');
        }

        // Find the biggest unspent output
        const biggestUnspent = unspentOutputs.reduce((prev, current) => {
            return prev.amount > current.amount ? prev : current;
        });

        console.log('Biggest Unspent Output:', biggestUnspent);

        // Return private key and unspent output data
        return {
            privateKey,
            utxo: {
                txid: biggestUnspent.txid,
                vout: biggestUnspent.vout,
                scriptPubKey: biggestUnspent.scriptPubKey,
                amount: biggestUnspent.amount
            }
        };
    } catch (error) {
        console.error('Error preparing transaction parameters:', error);
        throw error;
    }
}

// Example async function to send a transaction
async function sendTransactionWithParams(fromAddress, toAddress, propertyid, amount, sendall) {
    try {
        // Prepare parameters
        const { privateKey, utxo } = await prepareTransactionParams(fromAddress);

        console.log('Prepared Parameters:', { privateKey, utxo });

        // Call TxUtils.sendTransaction with the prepared parameters
        const txid = await TxUtils.sendTransaction(fromAddress, toAddress, propertyid, amount, false,
            privateKey,
            utxo
        );

        console.log('Transaction sent successfully.');
    } catch (error) {
        console.error('Error sending transaction:', error);
    }
}

// Example usage
sendTransactionWithParams(
    'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m',
    'tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr',//',
    5,
    10000,
    false
);

//tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8
//tltc1qtee90ysf57393hfqyn79syj9mkekm7hq0epqzw
//tltc1qxcyu5682whfzpjunwu6ek39dvc8lqmjtvxmscc