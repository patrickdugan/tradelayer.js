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


const loadWalletAsync = util.promisify(client.cmd.bind(client, 'loadwallet'))
async function load(){

const loadwallet = await loadWalletAsync(''/*wallet.dat'*/)
}

load()
