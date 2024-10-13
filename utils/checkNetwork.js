// checkChain.js
const client = require('../src/client'); // Import the client wrapper directly

async function checkNetworkInfo() {
  if (!client) {
    console.error('Failed to initialize client.');
    return;
  }

  try {
    const networkInfo = await client.getNetworkInfo();
    console.log('Connected chain info:', networkInfo);
    
    // Display specific details if available
    console.log('Subversion:', networkInfo.subversion);
    console.log('Connections:', networkInfo.connections);
  } catch (error) {
    console.error('Error fetching network info:', error);
  }

   const blockchainInfo = await client.getBlockchainInfo();
  const isTestnet = blockchainInfo.chain === 'test';
  console.log(isTestnet ? 'Running on Testnet' : 'Running on Mainnet');
}

// Run the check
checkNetworkInfo();
