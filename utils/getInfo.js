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


const getInfoAsync = util.promisify(client.cmd.bind(client, 'getblockchaininfo'))
async function load(){

const info = await getInfoAsync()
console.log(JSON.stringify(info))
}

load()
