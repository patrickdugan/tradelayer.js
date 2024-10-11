// client.js
const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin');
const Doge = require('dogecoind-rpc');

let clientInstance;
let selectedChain = 'LTC';  // Set a default chain here

const createClient = (chain,test = process.env.TEST) => {
  if (!clientInstance) {
    const config = {
      host: '127.0.0.1',
      port: test ? 18332 : 8332,
      user: 'user',
      pass: 'pass',
      timeout: 10000,
    };

    selectedChain = chain || 'LTC';  // Default to 'LTC' if no chain is provided
    if (chain === 'BTC') {
      clientInstance = new Bitcoin.Client(config);
    } else if (chain === 'DOGE') {
      clientInstance = new Doge.Client(config);
    } else {
      clientInstance = new Litecoin.Client(config);
    }
  }
  return clientInstance;
};

const getChain = () => selectedChain;

module.exports = { createClient, getClient: () => clientInstance, getChain };
