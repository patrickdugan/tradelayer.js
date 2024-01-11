const litecoin = require('litecoin');

exports.ltcClient = new litecoin.Client({
    host: '127.0.0.1',
    port: 18332, //for testnet
    user: 'user',
    pass: 'pass',
    timeout: 10000
})

