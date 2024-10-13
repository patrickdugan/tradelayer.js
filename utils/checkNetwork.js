// checkChain.js
const {createClient, getClient} = require('../src/client.js'); // Import your client wrapper

createClient('LTC',true)
const client = getClient()
async function checkNetworkInfo() {
  try {
    const networkInfo = await client.getNetworkInfo();
    console.log('Connected chain info:', networkInfo);
    
    // You can print specific details like:
    console.log('Network:', networkInfo.chain);
    console.log('Blocks:', networkInfo.blocks);
    console.log('Headers:', networkInfo.headers);
  } catch (error) {
    console.error('Error fetching network info:', error);
  }
}

// Run the check
checkNetworkInfo();
