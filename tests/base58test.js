const base58 = require('base-58');

// Function to encode an integer to base58
function encodeBase58(integer) {
  return base58.encode(Buffer.from(integer.toString(), 'hex'));
}

// Function to decode a base58 string to an integer
function decodeBase58(base58String) {
  return parseInt(Buffer.from(base58.decode(base58String)).toString('hex'), 16);
}

// Example Usage:
const amount = 10000557964;
const encodedBase58 = encodeBase58(amount);
console.log("Encoded Base58:", encodedBase58);

const decodedAmount = decodeBase58(encodedBase58);
console.log("Decoded Amount:", decodedAmount);
