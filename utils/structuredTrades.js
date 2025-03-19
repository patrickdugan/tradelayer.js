const litecoin = require('litecoin');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const encoder = require('../src/txEncoder.js'); // Assuming encoder handles OP_RETURN payloads
const BigNumber = require('bignumber.js')
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

// Standard fee for Litecoin transactions
const STANDARD_FEE = 2700; // in satoshis (0.00001 LTC)

async function createAndSendContractTrade(senderAddress, tradeParams, blockHeight) {
    try {
        console.log(`Fetching UTXOs for ${senderAddress}...`);
        const utxos = await listUnspentAsync(1, 9999999, [senderAddress]);
        console.log(JSON.stringify(utxos))
        if (!utxos || utxos.length === 0) {
            throw new Error(`No UTXOs found for address: ${senderAddress}`);
        }

        // Generate OP_RETURN payload for contract trade
        const tradePayload = encoder.encodeTradeContractOnchain(tradeParams);
        if (!tradePayload) {
            throw new Error("Failed to encode trade payload");
        }

        console.log("Encoded trade payload:", tradePayload.toString('hex'));

        // Select a UTXO to spend
        const selectedUtxo = utxos[0];

        // Get the sender's private key from the wallet
        console.log(`Fetching private key for ${senderAddress}...`);
        const privateKeyWIF = await dumpPrivKeyAsync(senderAddress);
        const privateKey = new litecore.PrivateKey(privateKeyWIF);
        const senderPublicKey = privateKey.toPublicKey();
       
        console.log('checking values for trade tx '+selectedUtxo+' '+new BigNumber(selectedUtxo.amount).times(1e8).toNumber()) 
        // Construct the transaction
        const tx = new litecore.Transaction()
            .from(selectedUtxo) // Use the first available UTXO
            .addOutput(new litecore.Transaction.Output({
                script: litecore.Script.buildDataOut(tradePayload), // Attach OP_RETURN
                satoshis: 0 // No value in OP_RETURN output
            }))
            .to(senderAddress, new BigNumber(selectedUtxo.amount).times(1e8).toNumber() - STANDARD_FEE) // Send change back
            .fee(STANDARD_FEE)
            .sign(privateKey);

        // Serialize and broadcast the transaction
        const serializedTx = tx.serialize();
        console.log("Signed TX:", serializedTx);

        const txid = await sendrawtransactionAsync(serializedTx);
        console.log(`Transaction sent! TXID: ${txid}`);
        return txid;

    } catch (error) {
        console.error("Error creating and sending contract trade:", error);
        throw error;
    }
}

// Suppose these are two test addresses with enough LTC & collateral
const aliceAddress = 'tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr'//tltc1qtee90ysf57393hfqyn79syj9mkekm7hq0epqzw';
const bobAddress = 'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m'//tltc1qxcyu5682whfzpjunwu6ek39dvc8lqmjtvxmscc';
const carolAddress = 'tltc1qqgru3cahyq5tj7l5q066ssv33gg3v7z9auxkcg'

contractId =3
// We'll create & broadcast a series of trades. 
// Make sure you have wallet handling in your code or direct signing.

async function structuredTestTrades() {
  // ============ 1) Alice places a BUY at price 5000, amount=5 ============
  const aliceBuy = {
    contractId: contractId,
    amount: 475,
    price: 142.5,
    sell: false 
  };
  // blockTime param is handled in your code, so you just pass in e.g. block=100
  await createAndSendContractTrade(bobAddress,/*aliceAddress,*/ aliceBuy, 100);

  // ============ 2) Bob places a SELL at price 5000, amount=5 ============
  const bobSell = {
    contractId: contractId,
    amount: 850,
    price: 142.7,
    sell: false 
  };

  //await createAndSendContractTrade(aliceAddress, aliceBuy, 100);

  // We'll assume these both appear in block #100 or so. 
  // In your real setup, you might need to manually confirm the block is mined
  // or wait a small time for `Main.processBlock(100)` to run.

  // ============ 3) Bob partially closes 2 contracts in block #101 ============
  // Now price might have changed to 5100. We'll do a buy order from Bob
  // so he's effectively reducing his short from 5 to 3. 
  const bobClose = {
    contractId: contractId,
    amount: 5,
    price: 104.5,
    sell: true // buy to close
  };
  //await createAndSendContractTrade(bobAddress, bobClose, 101);

  const aliceClose = {
    contractId: contractId,
    amount: 50,
    price: 128,
    sell: false // buy
  };

  //await createAndSendContractTrade(aliceAddress, aliceClose, 101);


  // Done
  console.log('Structured trades broadcast complete.');
}

structuredTestTrades().catch(err => {
  console.error('Error in structured test trades:', err);
});
