const util = require('util');
const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin');
const Doge = require('dogecoind-rpc');

let clientInstance = null;

class ClientWrapper {
   constructor() {
    if (clientInstance) {
      return clientInstance;
    }
    this.chain = null;
    this.client = null;
    clientInstance = this;
  }

   async init() {
    this.config = { host: '127.0.0.1', port: 18332, user: 'user', pass: 'pass', timeout: 10000 };
    console.log(this.config)
    this.client = new Litecoin.Client(this.config);
    const blockchainInfo = await this.getBlockchainInfo();
    const isTest = blockchainInfo.chain === 'test';
    console.log('is test '+isTest)
    const networkInfo = await this.getNetworkInfo();
    this.chain = this.determineChainFromSubversion(networkInfo.subversion);

    if (!this.chain) throw new Error('Unable to determine blockchain chain.');

    this.config.port = isTest 
      ? (this.chain === 'BTC' ? 18332 : this.chain === 'DOGE' ? 44556 : 18332)
      : (this.chain === 'BTC' ? 8332 : this.chain === 'DOGE' ? 22555 : 9332);

    this.client = this._createClientByChain(this.chain);
    return this.chain
  }

  _createClientByChain(chain) {
    switch (chain) {
      case 'BTC':
        return new Bitcoin.Client(this.config);
      case 'DOGE':
        return new Doge.Client(this.config);
      default:
        return new Litecoin.Client(this.config);
    }
  }a

   static async getInstance() {
    if (!clientInstance) {
      const clientWrapper = new ClientWrapper();
      await clientWrapper.init();
    }
    return clientInstance;
  }

  determineChainFromSubversion(subversion) {
    console.log(subversion )
    subversion = subversion.toLowerCase();
    if (subversion.includes('litecoin')) return 'LTC';
    if (subversion.includes('bitcoin')) return 'BTC';
    if (subversion.includes('dogecoin')) return 'DOGE';
    throw new Error(`Unknown chain in subversion: ${subversion}`);
  }

  getBlockchainInfo() {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockchaininfo'))();
  }

  getRawTransaction(txId, verbose = true) {
    return util.promisify(this.client.cmd.bind(this.client, 'getrawtransaction'))(txId, verbose);
  }


  getNetworkInfo(){
    return util.promisify(this.client.cmd.bind(this.client, 'getnetworkinfo'))()
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
      let match;
      if (subversion.includes('litecoin')) {
        match = 'LTC';
      } else if (subversion.includes('bitcoin')) {
        match = 'BTC';
      } else if (subversion.includes('dogecoin')) {
        match = 'DOGE';
      }

      if (match && match !== this.chain) {
        console.warn(`Mismatch: Configured chain is ${this.chain}, but detected ${match}.`);
        this.chain = match;
      } else {
        console.log(`Verified chain: ${this.chain}`);
      }
    } catch (error) {
      console.error('Error verifying chain:', error);
    }
  }

  async getChain() {
    const bleh= await this.getNetworkInfo(); // Double-check chain type  
    return this.determineChainFromSubversion(bleh.subversion);
  }

  async getTest(){
    const blockchainInfo = await this.getBlockchainInfo();
    return blockchainInfo.chain === 'test';
  }

  clientInstance = this;


  // Additional RPC methods as needed...
}

// Export singleton instance
module.exports = ClientWrapper;