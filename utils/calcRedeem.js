const crypto = require('crypto');

// Public key
const publicKey = Buffer.from('03860babecfccca06dc6a91e4071e91323464d885547662d4c0aba4660bef7', 'hex');

// Step 1: SHA-256
const sha256Hash = crypto.createHash('sha256').update(publicKey).digest();

// Step 2: RIPEMD-160
const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();

// Construct the redeem script
const redeemScript = Buffer.concat([
  Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 (0x14 is length of hash)
  ripemd160Hash,                   // Public key hash
  Buffer.from([0x88, 0xac])         // OP_EQUALVERIFY OP_CHECKSIG
]);

console.log('Redeem Script:', redeemScript.toString('hex'));
