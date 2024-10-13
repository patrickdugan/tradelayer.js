const util = require('util');
const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin');
const Doge = require('dogecoind-rpc');

class ClientWrapper {
  constructor() {

    getBlockchainInfo() {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockchaininfo'))();
    }

    const blockchainInfo = await client.getBlockchainInfo();
    const isTest = blockchainInfo.chain === 'test';

    this.chain = await verifyClientChain()
    this.config = {
        host: '127.0.0.1',
        port: isTest ? (chain === 'BTC' ? 18332 : chain === 'DOGE' ? 44556 : 18332) : (chain === 'BTC' ? 8332 : chain === 'DOGE' ? 22555 : 9332),
        user: 'user',
        pass: 'pass',
        timeout: 10000,
      };

    switch (chain) {
      case 'BTC':
        this.client = new Bitcoin.Client(this.config);
        break;
      case 'DOGE':
        this.client = new Doge.Client(this.config);
        break;
      default:
        this.client = new Litecoin.Client(this.config);
    }
  }

  getRawTransaction(txId) {
    return util.promisify(this.client.cmd.bind(this.client, 'getrawtransaction'))(txId);
  }

  getTransaction(txId) {
    return util.promisify(this.client.cmd.bind(this.client, 'gettransaction'))(txId);
  }

  getBlockData(blockHash) {
    return util.promisify(this.client.cmd.bind(this.client, 'getblock'))(blockHash);
  }

  createRawTransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'createrawtransaction'))(...params);
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

  // Add this method to the ClientWrapper class
  async verifyClientChain() {
    try {
      const networkInfo = await clientInstance.getNetworkInfo();
      const subversion = networkInfo.subversion.toLowerCase();
      console.log()
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

  getChain() {
    verifyClientChain(); // Double-check chain type
    return selectedChain;
  }

}

// Export as a singleton
const clientInstance = new ClientWrapper();
module.exports = clientInstance;