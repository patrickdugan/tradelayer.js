const Litecoin = require('litecoin'); // Replace with actual library import
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const txUtils = require('C:/projects/tradelayer.js/txUtilsA.js')
const fee = 1000

const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const sendrawtransactionAsync = util.promisify(client.cmd.bind(client, 'sendrawtransaction'));


//var privateKey = new litecore.PrivateKey('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');


async function main(){
	 // Define the minimum amount in satoshis
    const minAmountSatoshis = 15000; // Adjust this value as needed

    // Find a suitable UTXO
    var utxo = await txUtils.findSuitableUTXO('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8', minAmountSatoshis);
	console.log(utxo)
	var transaction = new litecore.Transaction()
		  .from(utxo)
		  .to('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8', 14000)
		  .addData('litecore rocks')
		  .change('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8')
		  .fee(fee)
		  .sign('cNGCJhHBSQM2Kedc8Zc6x9VYe9dQuvanqfS61D3tczZnDD3HwYUW');
	const serializedTx = transaction.serialize();
	const txid = await sendrawtransactionAsync(serializedTx);
	console.log(txid)

}


main()
