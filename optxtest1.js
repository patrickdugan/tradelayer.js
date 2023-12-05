const Litecoin = require('litecoin'); // Replace with actual library import
const async = require('async')
const util = require('util');
const bitcore = require('bitcore-lib-ltc');

const STANDARD_FEE = 0.0001; // Standard fee in LTC
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});


var privateKey ='' 

client.cmd('dumpprivkey','tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8',function(err,data){
	if(err){console.log(err)}
	privateKey = data
	console.log(privateKey)
});



const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const getrawtransactionAsync = util.promisify(client.cmd.bind(client, 'getrawtransaction'));

const rawTx = await getrawtransactionAsync('57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5')

console.log(rawTx)

async function getScriptPubKeyFromRawTx(rawTx, address, vout) {
    try {
        // Decode the raw transaction
        const decodedTx = await decoderawtransactionAsync('decoderawtransaction', rawTx);

        // Find the output with the matching address
        return decodedTx.vout[vout].scriptPubKey.hex;

    } catch (error) {
        console.error(`Error retrieving scriptPubKey:`, error);
        throw error;
    }
}

const scriptPubKey = getScriptPubKeyFromRawTx()

console.log(scriptPubKey)

var utxo = {
  "txId" : "57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5",
  "outputIndex" : `1`,
  "address" : "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8",
  "script" : "0014ebecd536259ef21bc6ecc18e45b35412f0472290",
  "satoshis" : 50000
};

var transaction = new bitcore.Transaction()
    .from(utxo)
    .addData('litecore rocks') // Add OP_RETURN data
    .sign(privateKey);

console.log(transaction)