const litecoin = require('litecoin');

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 19332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

client.getNewAddress(function(err, address) {
  if (err) {
    console.error(err);
    return;
  }

  console.log(address);
});
