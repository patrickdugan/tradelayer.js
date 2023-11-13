const level = require('level');

// Define the path to your LevelDB database
const dbPath = './my-leveldb';

// Open the LevelDB database
const db = level(dbPath);

// Function to store consensus hash for a block
function storeConsensusHash(blockHeight, consensusHash) {
  // Encode block height and consensus hash as keys and values
  const key = `block_${blockHeight}`;
  const value = JSON.stringify({ consensusHash });

  // Store the data in the LevelDB
  db.put(key, value, (err) => {
    if (err) {
      console.error('Error storing consensus hash:', err);
    } else {
      console.log(`Consensus hash for block ${blockHeight} stored.`);
    }
  });
}

// Function to retrieve consensus hash for a block
function getConsensusHash(blockHeight, callback) {
  const key = `block_${blockHeight}`;
  db.get(key, (err, value) => {
    if (err) {
      callback(err, null);
    } else {
      const data = JSON.parse(value);
      callback(null, data.consensusHash);
    }
  });
}

// Example usage
storeConsensusHash(1, 'consensus_hash_for_block_1');
getConsensusHash(1, (err, consensusHash) => {
  if (err) {
    console.error('Error retrieving consensus hash:', err);
  } else {
    console.log('Consensus hash for block 1:', consensusHash);
  }
});
