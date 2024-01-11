const litecore = require('bitcore-lib-ltc');
const TxUtils = require('../txUtils.js')

//var privateKey = new litecore.PrivateKey('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8');

async function test(){
    const minAmountSatoshis = 15000;
	const fee = 1800

    // Find a suitable UTXO
    var utxo = await TxUtils.findSuitableUTXO('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8', minAmountSatoshis);
	console.log(utxo)
	var transaction = new litecore.Transaction()
		  .from(utxo)
		  .to('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8', 14000)
		  .addData('litecore rocks')
		  .change('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8')
		  .fee(fee)
		  .sign('cNGCJhHBSQM2Kedc8Zc6x9VYe9dQuvanqfS61D3tczZnDD3HwYUW');
	const serializedTx = transaction.serialize();
	const txid = await TxUtils.sendRawTransactionAsync(serializedTx);
	console.log(txid)
}

(async() => await test())()
