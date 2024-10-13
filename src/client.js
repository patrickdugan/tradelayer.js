// client.js
const util = require('util');
const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin');
const Doge = require('dogecoind-rpc');

let clientInstance = null;
let selectedChain = null;
let isTestNet = false;

function createClient(chain = 'LTC', isTest = false) {
  if (clientInstance) {
    return clientInstance;
  }

  selectedChain = chain;
  isTestNet = isTest;

  const config = {
    host: '127.0.0.1',
    port: isTest ? (chain === 'BTC' ? 18332 : chain === 'DOGE' ? 44556 : 18332) : (chain === 'BTC' ? 8332 : chain === 'DOGE' ? 22555 : 9332),
    user: 'user',
    pass: 'pass',
    timeout: 10000,
  };

  let client;
  switch (chain) {
    case 'BTC':
      client = new Bitcoin.Client(config);
      break;
    case 'DOGE':
      client = new Doge.Client(config);
      break;
    default:
      client = new Litecoin.Client(config);
  }

  clientInstance = {
    getRawTransaction: (txId) => util.promisify(client.getRawTransaction.bind(client))(txId),
    getTransaction: (txId) => util.promisify(client.cmd.bind(client, 'gettransaction'))(txId),
    getBlockData: (blockHash) => util.promisify(client.getBlock.bind(client))(blockHash),
    createRawTransaction: (...params) => util.promisify(client.createRawTransaction.bind(client))(...params),
    listUnspent: (...params) => util.promisify(client.cmd.bind(client, 'listunspent'))(...params),
    decoderawtransaction: (...params) => util.promisify(client.cmd.bind(client, 'decoderawtransaction'))(...params),
    signrawtransactionwithwallet: (...params) => util.promisify(client.cmd.bind(client, 'signrawtransactionwithwallet'))(...params),
    dumpprivkey: (...params) => util.promisify(client.cmd.bind(client, 'dumpprivkey'))(...params),
    sendrawtransaction: (...params) => util.promisify(client.cmd.bind(client, 'sendrawtransaction'))(...params),
    validateAddress: (...params) => util.promisify(client.cmd.bind(client, 'validateaddress'))(...params),
    getBlockCount: () => util.promisify(client.cmd.bind(client, 'getblockcount'))(),
    loadWallet: (...params) => util.promisify(client.cmd.bind(client, 'loadwallet'))(...params),
    getNetworkInfo: (...params) => util.promisify(client.cmd.bind(client, 'getnetworkinfo'))(...params),
  };

  verifyClientChain();

  return clientInstance;
}

// client.js

// Add this method to the ClientWrapper class
async function verifyClientChain() {
  try {
    const networkInfo = await clientInstance.getNetworkInfo();
    const subversion = networkInfo.subversion.toLowerCase();

    let match;
    if (subversion.includes('litecoin')) {
      match = 'LTC';
    } else if (subversion.includes('bitcoin')) {
      match = 'BTC';
    } else if (subversion.includes('dogecoin')) {
      match = 'DOGE';
    }

    if (match && match !== selectedChain) {
      console.warn(`Mismatch: Configured chain is ${selectedChain}, but detected ${match}.`);
      selectedChain = match;
    } else {
      console.log(`Verified chain: ${selectedChain}`);
    }
  } catch (error) {
    console.error('Error verifying chain:', error);
  }
}

function getChain() {
  verifyClientChain(); // Double-check chain type
  return selectedChain;
}


function getClient() {
  return clientInstance;
}

function getTest() {
  return isTestNet;
}

module.exports = {
  createClient,
  getClient,
  getChain,
  getTest,
};
