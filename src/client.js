const util = require('util');
const Litecoin = require('litecoin');
const Bitcoin = require('bitcoin');
const Doge = require('dogecoind-rpc');

// --- ENV bootstrap helpers (safe if .env is missing) ---
const path = require('path');

function loadDotenvFromKnownLocations() {
  // lazy-load to avoid hard dependency if dotenv isn't installed yet
  let dotenv;
  try { dotenv = require('dotenv'); } catch { return; }

  // 1) repo-style: one level up relative to this file (…/ .env)
  const repoEnv = path.join(__dirname, '..', '.env');
  dotenv.config({ path: repoEnv, override: false });

  // 2) fallback: current working directory (.env)
  dotenv.config({ override: false });
}

function getRpcBootstrapFromEnv(defaultChain = 'LTC') {
  loadDotenvFromKnownLocations();

  const env = process.env;
  const ENV_CHAIN  = (env.CHAIN || '').toUpperCase();
  const AUTODETECT = (env.AUTODETECT || '1') !== '0'; // AUTODETECT=0 → lock env, skip discovery

  const DEFAULT_PORT = {
    BTC: 8332,
    BTCTEST: 48332,
    BTC_TESTNET: 18332,
    BTC_TESTNET4: 48332,
    LTC: 9332,
    LTCTEST: 19332,
    DOGE: 22555,
    DOGETEST: 44555
  };
  const CHAIN_ALIASES = {
    BTC: 'BTC',
    BTCTEST: 'BTC',
    BTC_TESTNET: 'BTC',
    BTC_TESTNET4: 'BTC',
    LTC: 'LTC',
    LTCTEST: 'LTC',
    DOGE: 'DOGE',
    DOGETEST: 'DOGE'
  };
  const selected = CHAIN_ALIASES[ENV_CHAIN] ? ENV_CHAIN : String(defaultChain || 'LTC').toUpperCase();
  const chain = CHAIN_ALIASES[selected] || CHAIN_ALIASES[String(defaultChain || 'LTC').toUpperCase()] || defaultChain;

  let cookieUser = '';
  let cookiePass = '';
  if (env.RPC_COOKIE_FILE) {
    try {
      const cookie = require('fs').readFileSync(env.RPC_COOKIE_FILE, 'utf8').trim();
      const splitAt = cookie.indexOf(':');
      if (splitAt > -1) {
        cookieUser = cookie.slice(0, splitAt);
        cookiePass = cookie.slice(splitAt + 1);
      }
    } catch (err) {
      if (!env.RPC_USER || !env.RPC_PASS) {
        throw new Error(`Unable to read RPC_COOKIE_FILE ${env.RPC_COOKIE_FILE}: ${err.message}`);
      }
    }
  }

  const host = env.RPC_HOST || '127.0.0.1';
  const user = env.RPC_USER || cookieUser || 'user';
  const pass = env.RPC_PASS || cookiePass || 'pass';
  const port = Number(env.RPC_PORT || DEFAULT_PORT[selected] || DEFAULT_PORT[chain]);
  const timeout = Number(env.TIMEOUT_MS || 60000);

  // If any of CHAIN / RPC_PORT is provided OR AUTODETECT=0, we consider this a "locked" bootstrap.
  const locked = (!AUTODETECT) || !!env.CHAIN || !!env.RPC_PORT;

  return {
    // normalized values
    chain, network: selected, host, port, user, pass, timeout,
    // whether the caller should skip autodetect and return immediately
    locked,
  };
}


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
	     const boot = this.getEnvBootstrap('LTCTEST'); // default LTC; change to 'BTC' if you prefer

	this.config = {
	  host: boot.host,
	  port: boot.port,
	  user: boot.user,
	  pass: boot.pass,
	  timeout: boot.timeout,
	};

	// Build a client immediately using the env-chosen CHAIN (or default)
	this.chain  = boot.chain;
    this.network = boot.network;
	this.client = this._createClientByChain(this.chain);

	// If .env told us to lock (AUTODETECT=0 or CHAIN/RPC_PORT provided), stop here.
	// (No probing needed; this lets desktop/server scripts fully control startup.)
	if (boot.locked) {
	  return this.chain;
	}

      // Wait for the blockchain to finish initial block download and indexing.
      // `-28 Loading block index...` is a transient startup state, not a fatal error.
      let blockchainInfo = null;
      for (let attempt = 0; attempt < 180; attempt++) {
        try {
          blockchainInfo = await this.getBlockchainInfo();
          if (blockchainInfo) break;
        } catch (error) {
          const transient = error?.code === -28 || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT';
          if (!transient) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!blockchainInfo) {
        throw new Error('Timed out waiting for Litecoin RPC to finish loading the block index.');
      }

      const isTest = blockchainInfo.chain === 'test';
      console.log('is test '+isTest)

      const networkInfo = await this.getNetworkInfo();
      console.log('determining chain in init '+JSON.stringify(networkInfo))
      this.chain = this.determineChainFromSubversion(networkInfo.subversion);

      if (!this.chain) throw new Error('Unable to determine blockchain chain.');

      this.config.port = isTest 
        ? (this.chain === 'BTC' ? 18332 : this.chain === 'DOGE' ? 44556 : 19332)
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

  // inside your existing class (e.g., RpcClient / whatever it’s named)
	getEnvBootstrap(defaultChain = 'LTC') {
  		return getRpcBootstrapFromEnv(defaultChain);
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
    if (subversion.includes('bitcoin') || subversion.includes('satoshi')) return 'BTC';
    if (subversion.includes('dogecoin')) return 'DOGE';
    throw new Error(`Unknown chain in subversion: ${subversion}`);
  }

  getBlockchainInfo() {
    return util.promisify(this.client.cmd.bind(this.client, 'getblockchaininfo'))();
  }

  getRawTransaction(txId, verbose = true, blockHash) {
    return util.promisify(this.client.cmd.bind(this.client, 'getrawtransaction'))(txId, verbose);
  }

  getnewaddress() {
    return util.promisify(this.client.cmd.bind(this.client, 'getnewaddress'))();
  }

  sendtoaddress(addr,amt){
    return util.promisify(this.client.cmd.bind(this.client, 'sendtoaddress'))(addr,amt)
  }

  getNetworkInfo(){
    return util.promisify(this.client.cmd.bind(this.client, 'getnetworkinfo'))()
  }

  getWalletPath() {
    const wallet = process.env.RPC_WALLET || process.env.LTC_WALLET || process.env.WALLET_NAME;
    return wallet ? `/wallet/${wallet}` : null;
  }

  rpcCall(method, params = [], walletScoped = false) {
    const path = walletScoped ? this.getWalletPath() : null;
    const rpc = this.client && this.client.rpc;
    if (!rpc || typeof rpc.call !== 'function' || !path) {
      return util.promisify(this.client.cmd.bind(this.client, method))(...params);
    }

    return new Promise((resolve, reject) => {
      rpc.call(
        method,
        params,
        (result) => resolve(result),
        (err) => reject(err),
        path
      );
    });
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
    return this.rpcCall('listunspent', params, true);
  }

  decoderawtransaction(...params) {
    return util.promisify(this.client.cmd.bind(this.client, 'decoderawtransaction'))(...params);
  }

  signrawtransactionwithwallet(...params) {
    return this.rpcCall('signrawtransactionwithwallet', params, true);
  }

  dumpprivkey(...params) {
    return this.rpcCall('dumpprivkey', params, true);
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

  listlabels(...params) {
    return this.rpcCall('listlabels', params, true);
  }

  getaddressesbylabel(label) {
    return this.rpcCall('getaddressesbylabel', [label], true);
  }

  getwalletinfo() {
    return this.rpcCall('getwalletinfo', [], true);
  }

  listunspent() {
    return this.rpcCall('listunspent', [], true);
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
    return blockchainInfo.chain === 'test' || blockchainInfo.chain === 'testnet4' || blockchainInfo.chain === 'signet' || blockchainInfo.chain === 'regtest';
  }

  clientInstance = this;


  // Additional RPC methods as needed...
}

// Export singleton instance
module.exports = ClientWrapper;
