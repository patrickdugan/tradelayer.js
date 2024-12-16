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
    this.initializing = false
    clientInstance = this;  // Assign the instance to the singleton variable
  }

   async init() {

     // If already initializing, wait for the process to finish
    if (this.isInitializing) {
      console.log('Client initialization already in progress. Waiting...');
      return this.waitForInitialization();  // Wait for ongoing initialization to complete
    }

    this.isInitializing = true; // Set flag to indicate initialization is in progress

    if(!this.client){
      this.config = { host: '127.0.0.1', port: 18332, user: 'user', pass: 'pass', timeout: 30000 };
      console.log(this.config)
      this.client = new Litecoin.Client(this.config);

      // Wait for the blockchain to finish initial block download and indexing
      let isTest = true
       try {
          const blockchainInfo = await this.getBlockchainInfo();
           isTest = blockchainInfo.chain === 'test';
           console.log('is test '+isTest)
        }catch (error) {
            if (error.code === -28) {
              console.log('Getting the err on the second call.');
            }
        }

      const networkInfo = await this.getNetworkInfo();
      console.log('determining chain in init ')
      this.chain = this.determineChainFromSubversion(networkInfo.subversion);

      if (!this.chain) throw new Error('Unable to determine blockchain chain.');

      this.config.port = isTest 
        ? (this.chain === 'BTC' ? 18332 : this.chain === 'DOGE' ? 44556 : 18332)
        : (this.chain === 'BTC' ? 8332 : this.chain === 'DOGE' ? 22555 : 9332);

      this.client = this._createClientByChain(this.chain);
      }
      return this.chain
  }

   async waitForInitialization() {
    while (this.isInitializing) {
      console.log('waiting for initialization')
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms between checks
    }
    return this.chain;  // Return the chain after initialization completes
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
  }

   static async getInstance(txIndex) {
    if (!clientInstance) {
      if(txIndex){console.log('initializing client by way of txIndex')}
        if(this.isInitializing){await this.waitForInitialization()}
      const clientWrapper = new ClientWrapper();
    console.log('constructed client wrapper now init')
      await clientWrapper.init();
    }
    return clientInstance;
  }

  determineChainFromSubversion(subversion, flag) {
    console.log('chain subversion '+subversion+' '+flag )
    subversion = subversion.toLowerCase();
    if (subversion.includes('litecoin')) return 'LTC';
    if (subversion.includes('bitcoin')) return 'BTC';
    if (subversion.includes('dogecoin')) return 'DOGE';
    throw new Error(`Unknown chain in subversion: ${subversion}`);
  }

  getBlockchainInfo() {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockchaininfo'))();
  }

  getRawTransaction(txId, verbose = true, blockHash) {
    return util.promisify(this.client.cmd.bind(this.client, 'getrawtransaction'))(txId, verbose);
  }


  getNetworkInfo(){
    return util.promisify(this.client.cmd.bind(this.client, 'getnetworkinfo'))()
  }

  getTransaction(txId) {
    return util.promisify(this.client.cmd.bind(this.client, 'gettransaction'))(txId);
  }

  getBlock(blockHash) {
    return util.promisify(this.client.cmd.bind(this.client, 'getblock'))(blockHash);
  }

  getBlockHash(height) {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockhash'))(height);
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
    console.log('determining chain in get chain')  
    return this.determineChainFromSubversion(bleh.subversion, true);
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