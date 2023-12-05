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

client.getTransaction('0513576fa72ffdd721176dfc5a971af50958102070f55fce6d50aa604c6d0cb0',function(err,data){
	console.log(data)
})



