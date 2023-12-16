const Litecoin = require('litecoin'); // Replace with actual library import
const async = require('async')
const STANDARD_FEE = 0.0001; // Standard fee in LTC
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const util = require('util');
// ... rest of your setup ...

// Promisify the createRawTransaction function
client.createRawTransaction = util.promisify(client.createRawTransaction);

async function createRawTransaction() {
    try {
        const inputs = [{
            "txid": "57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5",
            "vout": 1
        }];

        // Specify the output with the address and amount (example amount here is 0.01 LTC)
        const outputs = {
            "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8": 0.01
        };

        const rawTx = await client.createRawTransaction(inputs, outputs);
        if (rawTx) {
            console.log('Raw Transaction:', rawTx);
        } else {
            console.log('Raw Transaction is undefined. Check if litecoind is running and accepting RPC commands.');
        }
        return rawTx;
    } catch (error) {
        console.error('Error creating raw transaction:', error);
    }
}

createRawTransaction();


/*client.createRawTransaction([{txid:"57dbb47d8db6249b720421d78052e6f168664f3c062f1fbe187270ff5edd4dc5",vout:1}],[{
            "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8": 0.01
        }],function(err,data){
    if(err){console.log(err)}
    console.log(data)
})*/