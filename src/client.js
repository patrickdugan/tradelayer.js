// client.js
const util = require('util');
const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin');
const Doge = require('dogecoind-rpc');

class ClientWrapper {
  constructor(chain = 'LTC', isTest = false) {
    if (!ClientWrapper.instance) {
      this.selectedChain = chain;
      this.config = {
        host: '127.0.0.1',
        port: isTest ? (chain === 'BTC' ? 18332 : chain === 'DOGE' ? 44556 : 19332) : (chain === 'BTC' ? 8332 : chain === 'DOGE' ? 22555 : 9332),
        user: 'user',
        pass: 'pass',
        timeout: 10000,
      };
      
      this.client = this.createClient(chain);
      ClientWrapper.instance = this;
    }
    return ClientWrapper.instance;
  }

  createClient(chain) {
    switch (chain) {
      case 'BTC':
        return new Bitcoin.Client(this.config);
      case 'DOGE':
        return new Doge.Client(this.config);
      default:
        return new Litecoin.Client(this.config);
    }
  }

  getSelectedChain() {
    return this.selectedChain;
  }

  // Define methods to interact with the RPC client
  getRawTransaction(txId) {
    return util.promisify(this.client.getRawTransaction.bind(this.client))(txId);
  }

  getBlockData(blockHash) {
    return util.promisify(this.client.getBlock.bind(this.client))(blockHash);
  }

  createRawTransaction(...params) {
    return util.promisify(this.client.createRawTransaction.bind(this.client))(...params);
  }

  listUnspent(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'listunspent'))(...params);
  }

  decoderawtransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'decoderawtransaction'))(...params);
  }

  signrawtransactionwithwallet(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'signrawtransactionwithwallet'))(...params);
  }

  dumpprivkey(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'dumpprivkey'))(...params);
  }

  sendrawtransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'sendrawtransaction'))(...params);
  }

  validateAddress(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'validateaddress'))(...params);
  }

  getBlockCount() {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockcount'))();
  }

  loadWallet(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'loadwallet'))(...params);
  }
}

// Singleton instance to be used across the application
const clientInstance = new ClientWrapper();
module.exports = clientInstance;
