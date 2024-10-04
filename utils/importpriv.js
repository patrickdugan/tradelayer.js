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


const importPrivKeyAsync = util.promisify(client.cmd.bind(client, 'importprivkey'))
async function load(){

const imported = await importPrivKeyAsync('cNGCJhHBSQM2Kedc8Zc6x9VYe9dQuvanqfS61D3tczZnDD3HwYUW')
}

load()
