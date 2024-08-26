const async = require('async');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const Encode = require('./txEncoder.js');
const litecoin = require('litecoin');

const clientConfig = /*test ?*/ {
            host: '127.0.0.1',
            port: 18332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        }

const client = new litecoin.Client(clientConfig);
// Assuming standard fee and other constants are defined
const STANDARD_FEE = 10000; // Standard fee in satoshis
const DUST_THRESHOLD = 54600;

// Promisify client functions
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client, 'sendrawtransaction'));

async function sendLitecoin(senderAddress, recipientAddress, amountToSend) {
    let send = amountToSend*100000000
    try {
        // Fetch the private key for the sender address
        const privateKeyWIF = await dumpprivkeyAsync(senderAddress);
        console.log('privateKeyWIF '+privateKeyWIF)
        const privateKey = new litecore.PrivateKey.fromWIF(privateKeyWIF);
        console.log('privatekey '+privateKey)
        // Fetch UTXOs for the sender address
        const utxos = await listUnspentAsync(1, 9999999, [senderAddress]);
        if (!utxos || utxos.length === 0) {
            throw new Error('No UTXOs available for the sender address');
        }

        // Create a new transaction
        const tx = new litecore.Transaction()
            .from(utxos)
            .to(recipientAddress, send)
            .change(senderAddress)
            .fee(STANDARD_FEE)
            .sign(privateKey);

        // Serialize and broadcast the transaction
        const serializedTx = tx.serialize();
        const txid = await sendrawtransactionAsync(serializedTx);
        console.log(`Transaction sent successfully. TXID: ${txid}`);
    } catch (error) {
        console.error('Error sending Litecoin:', error);
    }
}

// Replace with actual values
const senderAddress = "tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr"; //tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8
const recipientAddress = "tltc1qvzxl5xd8wdh4xf7e2xax30ev8fv6r78z9syvxq"//tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m" //"tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz"
const amountToSend = 0.005; // Amount of LTC to send

// Execute the function to send Litecoin
sendLitecoin(senderAddress, recipientAddress, amountToSend);
