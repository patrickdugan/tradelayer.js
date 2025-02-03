const litecoin = require('litecoin');
const axios = require('axios');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const encoder = require('../src/txEncoder.js')
const interface = require('../src/walletInterface.js')

const clientConfig = {
    host: '127.0.0.1',
    port: 18332, // Testnet RPC port
    user: 'user',
    pass: 'pass',
    timeout: 10000
};

const client = new litecoin.Client(clientConfig);

// Promisify necessary RPC commands
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const dumpPrivKeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'));
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client, 'sendrawtransaction'));

// Admin Address
const adminAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';

// Build, sign, and broadcast transaction
async function buildSignAndSendTransaction(fromAddress) {
    try {
        console.log('Preparing transaction...');

        // Step 1: Dump private key and get UTXOs
        const privateKeyWIF = await dumpPrivKeyAsync(fromAddress);
        const privateKey = litecore.PrivateKey.fromWIF(privateKeyWIF);
        const unspentOutputs = await listUnspentAsync(0, 9999999, [fromAddress]);

        if (!unspentOutputs.length) throw new Error('No unspent outputs available.');

        // Step 2: Select the largest UTXO
        const largestUTXO = unspentOutputs.reduce((prev, curr) => prev.amount > curr.amount ? prev : curr);

        console.log('Using UTXO:', largestUTXO);

        // Step 3: Create and sign transaction
        const utxo = {
            txId: largestUTXO.txid,
            outputIndex: largestUTXO.vout,
            script: largestUTXO.scriptPubKey,
            satoshis: Math.floor(largestUTXO.amount * 1e8)
        };

        const params = {revoke:0, id:0, targetAddress:fromAddress,metaData:metadata}

        const payload = encoder.encodeIssueOrRevokeAttestation(params)

        const transaction = new litecore.Transaction()
            .from(utxo) // UTXO input
            .addOutput(new litecore.Transaction.Output({
                satoshis: 1000, // small OP_RETURN fee
                script: litecore.Script.buildDataOut(payload) // Embed metadata in OP_RETURN
            }))
            .change(fromAddress) // Change back to sender
            .sign(privateKey); // Sign transaction

        console.log('Raw Transaction Hex:', transaction.toString());

        // Step 4: Broadcast transaction
        const txid = await sendrawtransactionAsync(transaction.serialize());
        console.log(`Transaction broadcasted successfully. TXID: ${txid}`);
    } catch (error) {
        console.error('Error building/signing transaction:', error.message);
        throw error;
    }
}

// Main function to issue attestation
async function issueAttestation(address, metadata) {
    try {
        const fromAddress = await findAddressWithTLBalance();
        console.log(`Sending attestation from ${fromAddress} with metadata: ${metadata}`);
        await buildSignAndSendTransaction(fromAddress, metadata);
    } catch (error) {
        console.error('Failed to issue attestation:', error.message);
    }
}

// Run the attestation script
buildSignAndSendTransaction('tltc1qxcyu5682whfzpjunwu6ek39dvc8lqmjtvxmscc');
                             
