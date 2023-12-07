const litecoin = require('litecoin');

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 8332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const tx = "85f459ae3422aff3e01c2ba240605f997befd2a639d87b3b72b5456a8aeaf610";

console.log("Fetching raw transaction...");

client.getRawTransaction(tx, true, function(err, rawtx) {
  if (err) {
    console.error(err);
    return;
  }

  console.log(rawtx);
});
