const litecoin = require('litecoin');
const fs = require('fs');
const path = require('path');

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

client.cmd('createwallet','', function(err, walletInfo) {
    if (err) {
        console.error('Error creating new wallet:', err);
        return;
    }
    console.log('New Wallet Info:', walletInfo);
});

client.getBalance('*', 1, function(err, balance) {
    if (err) {
        console.error('Error fetching balance:', err);
        return;
    }
    console.log('Total Wallet Balance:', balance, 'LTC');
});

client.listUnspent(1, 9999999, function(err, unspent) {
    if (err) {
        console.error('Error listing unspent transactions:', err);
        return;
    }
    console.log('Unspent Transactions:', unspent);
});

client.getNewAddress(function(err, address) {
    if (err) {
        console.error('Error fetching new address:', err);
        return;
    }
    console.log('New Address:', address);
});