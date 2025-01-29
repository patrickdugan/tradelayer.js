#!/usr/bin/env node

const crypto = require('crypto');

// 1) Replace these with your actual hex values:
const scriptPubKeyHex = '00204a64b51ca4b44f11f87da5ff33142660b39a0e3bcce6b658ebbdadb7f3660fd6';
const witnessScriptHex = '52210292eece65f01fcd2e035cfd8e5e13b06f4db32dd22e7b6bc1947eb8769f0d0149210274e3b737c001205e209e6f3f290dfe3ef8e2df9f08a928eb4b742b8a6473af4c52ae';

// 2) Convert hex strings to Buffers
const scriptPubKeyBuf = Buffer.from(scriptPubKeyHex, 'hex');
const witnessScriptBuf = Buffer.from(witnessScriptHex, 'hex');

// 3) P2WSH scriptPubKey must be: OP_0 (0x00), PUSH_32 (0x20), then 32-byte hash
//    So the first byte is 0x00, second byte is 0x20, next 32 bytes is the script hash.
if (scriptPubKeyBuf.length !== 34 || scriptPubKeyBuf[0] !== 0x00 || scriptPubKeyBuf[1] !== 0x20) {
  console.error('scriptPubKey does not look like a native P2WSH (expected 00 20 <32-bytes>)');
  process.exit(1);
}

// Extract the 32-byte (sha256) hash part
const expectedHash = scriptPubKeyBuf.slice(2); // from byte index 2 to the end

// 4) Compute sha256 of your witnessScript
const actualHash = crypto.createHash('sha256').update(witnessScriptBuf).digest();

// 5) Compare them
const matches = expectedHash.equals(actualHash);

console.log('----------------------------------------');
console.log(' scriptPubKey:', scriptPubKeyHex);
console.log(' witnessScript:', witnessScriptHex);
console.log(' expectedHash (from scriptPubKey):', expectedHash.toString('hex'));
console.log(' actualHash   (sha256 of witnessScript):', actualHash.toString('hex'));
console.log(' Do they match?', matches);
console.log('----------------------------------------');

if (!matches) {
  console.error('❌  The witnessScript does NOT match the scriptPubKey’s 32-byte hash.');
} else {
  console.log('✅  The witnessScript matches the scriptPubKey hash (P2WSH is correct).');
}
