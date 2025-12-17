const litecoin = require('litecoin');
const axios = require('axios');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const encoder = require('../src/txEncoder.js');

const clientConfig = {
    host: '127.0.0.1',
    port: 19332, // Testnet RPC port
    user: 'user',
    pass: 'pass',
    timeout: 10000
};

const client = new litecoin.Client(clientConfig);

// Promisify necessary RPC commands
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const dumpPrivKeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client, 'sendrawtransaction'));

const LTC_PRICE_API_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd';

//'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd';

// Fetch the BTC price
async function fetchBTCPrice() {
    try {
        const response = await axios.get(LTC_PRICE_API_URL);
        const price = response.data.litecoin.usd;
        console.log('Fetched BTC Price:', price);
        return price;
    } catch (error) {
        console.error('Error fetching BTC price:', error.message);
        throw error;
    }
}

// Build, sign, and send the transaction
async function buildSignAndSendTransaction(fromAddress, btcPrice) {
    try {
        console.log('Preparing transaction with BTC Price:', btcPrice);

        // Dump private key and get UTXOs
        const privateKeyWIF = await dumpPrivKeyAsync(fromAddress);
        const privateKey = litecore.PrivateKey.fromWIF(privateKeyWIF);
        const unspentOutputs = await listUnspentAsync(0, 9999999, [fromAddress]);
        console.log('unspent '+JSON.stringify(unspentOutputs))
        if (!unspentOutputs.length) throw new Error('No unspent outputs available.');

        // Select the largest UTXO
        const largestUTXO = unspentOutputs.reduce((prev, curr) => prev.amount > curr.amount ? prev : curr);
        console.log('Using UTXO:', largestUTXO);
        if(largestUTXO.spendable==true){
             const utxo = {
                txId: largestUTXO.txid,
                outputIndex: largestUTXO.vout,
                script: largestUTXO.scriptPubKey,
                satoshis: Math.floor(largestUTXO.amount * 1e8)
            };
        }else{
            const utxo = unspentOutputs
        }
       

        // Create the payload
        const params = {
            oracleid: 2,
            price: 180,//btcPrice,
            targetAddress: fromAddress
        };

        const payload = encoder.encodePublishOracleData(params);

        // Create and sign the transaction
        const transaction = new litecore.Transaction()
            .from(largestUTXO) // Add UTXO as input
            .addOutput(new litecore.Transaction.Output({
                satoshis: 0, // OP_RETURN fee
                script: litecore.Script.buildDataOut(payload) // Embed payload in OP_RETURN
            }))
            .change(fromAddress) // Send change back to sender
            .sign(privateKey); // Sign transaction

        console.log('Raw Transaction Hex:', transaction.toString());

        // Broadcast the transaction
        const txid = await sendrawtransactionAsync(transaction.serialize());
        console.log(`Transaction broadcasted successfully. TXID: ${txid}`);
    } catch (error) {
        console.error('Error building/signing transaction:', error.message);
        throw error;
    }
}

// Main function to fetch BTC price and send the attestation
async function publishBTCPrice() {
    try {
        const fromAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'; // Admin address
        const btcPrice = await fetchBTCPrice();
        await buildSignAndSendTransaction(fromAddress, btcPrice);
    } catch (error) {
        console.error('Failed to publish BTC price:', error.message);
    }
}

publishBTCPrice()

// Run the attestation script every 150 seconds
setInterval(() => {
    console.log('Starting BTC price publish cycle...');
    publishBTCPrice();
}, 150 * 1000); // 150 seconds in milliseconds
