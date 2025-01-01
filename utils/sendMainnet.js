const async = require('async');
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const Encode = require('../src/txEncoder.js');

// Assuming standard fee and other constants are defined
const STANDARD_FEE = 25000; // Standard fee in satoshis
const DUST_THRESHOLD = 54600;

async function sendLitecoin(senderAddress, recipientAddress, amountToSend) {
    let send = (amountToSend*100000000)-STANDARD_FEE
    try {
        // Fetch the private key for the sender address
        // Fetch UTXOs for the sender address

        //console.log('bleh '+litecore.Script.buildScriptHashOut('d9feb2d55d2c022d4fc463ab54dcbdd75f7b0ebc'))
         const utxos = [{
          txId: 'f6eeb745cd69d3d9d988695ee8a241f5819c5a0304d17c59c139bca4e1213aa8',
          outputIndex: 0,
          address: senderAddress,
          script: "a914d9feb2d55d2c022d4fc463ab54dcbdd75f7b0ebc87",
          satoshis: 0.00075 * 1e8, // Amount in satoshis
        }]
        const params = {
              sendAll: 0, // Activation types
              propertyId: 1,
              amount: 400,
              address: 'LLQKK63jPtfVgCHE7jg1kgVRas9pR68BRG',
              isColoredOutput: 0
            };
    const opReturnData = Encode.encodeSend(params);
    console.log('payload '+opReturnData)
    const opReturnScript = litecore.Script.buildDataOut(opReturnData);
        // Create a new transaction
        const tx = new litecore.Transaction()
            .from(utxos)
            .to(recipientAddress, send)
            //.change(senderAddress)
            .fee(STANDARD_FEE)
            .addOutput(new litecore.Transaction.Output({
                script: opReturnScript,
                satoshis: 0,
              }))
            //.sign(privateKey);

        // Serialize and broadcast the transaction
        const serializedTx = tx.toString();
        //const txid = await sendrawtransactionAsync(serializedTx);
        console.log(`Transaction hex to sign: ${tx}`);
    } catch (error) {
        console.error('Error sending Litecoin:', error);
    }
}

// Replace with actual values
const senderAddress = "MTmoypkhRQoJ172ZqxcsVumPZfJ8KCrQCB"; //tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr
const recipientAddress = "MTmoypkhRQoJ172ZqxcsVumPZfJ8KCrQCB"
//tltc1qp5z2la8sy69np798pc36up5zk2vg0fw2g7pml2"//tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m" //"tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz"
const amountToSend = 0.00075; // Amount of LTC to send

// Execute the function to send Litecoin
sendLitecoin(senderAddress, recipientAddress, amountToSend);
