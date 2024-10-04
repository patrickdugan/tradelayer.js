const Litecoin = require('litecoin');
const async = require('async')
const util = require('util');

const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 1000
});


const createWalletAsync = util.promisify(client.cmd.bind(client, 'createwallet'))
async function load(){

const createwallet = await createWalletAsync('wallet.dat')
}

load()
