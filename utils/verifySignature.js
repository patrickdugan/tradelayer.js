const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');

// Create the ECPair factory
const ECPair = ECPairFactory(ecc);

// The Dogecoin network parameters
const dogecoinNetwork = {
  messagePrefix: '\x19Dogecoin Signed Message:\n',
  bech32: null,
  bip32: {
    public: 0x02facafd,
    private: 0x02fac398,
  },
  pubKeyHash: 0x1e, // 'D' prefix
  scriptHash: 0x16, // '9' prefix
  wif: 0x9e,
};

/**
 * Verify a P2PKH signature in a raw Dogecoin transaction input.
 *
 * @param {string} rawTxHex - Raw transaction hex.
 * @param {number} inputIndex - Index of the input to verify.
 * @param {string} scriptPubKeyHex - The scriptPubKey in hex from the UTXO.
 */
function verifySignature(rawTxHex, inputIndex, scriptPubKeyHex) {
  try {
    // 1) Parse the raw transaction
    const tx = bitcoin.Transaction.fromHex(rawTxHex);

    // 2) Get the input
    const input = tx.ins[inputIndex];
    if (!input) throw new Error(`Input index ${inputIndex} does not exist in the transaction.`);

    // 3) Decompile the scriptSig -> [signature, publicKey]
    const scriptSig = bitcoin.script.decompile(input.script);
    if (!scriptSig || scriptSig.length !== 2) {
      throw new Error('Invalid scriptSig format (expected [signature, publicKey]).');
    }
    const [rawSigWithSighash, publicKey] = scriptSig;

    // 4) Decode the signature to extract the DER-encoded bytes & the sighash type
    const { signature, hashType } = bitcoin.script.signature.decode(rawSigWithSighash);
    // signature is the DER-encoded signature without the sighash byte
    // hashType is the sighash type (0x01 = SIGHASH_ALL, etc.)

    // 5) scriptPubKey & embedded pubKeyHash
    const spkBuf = Buffer.from(scriptPubKeyHex, 'hex');
    const decompiledSPK = bitcoin.script.decompile(spkBuf);
    const embeddedHash = decompiledSPK[2]; // pubKeyHash (20 bytes)

    // 6) Compute pubKeyHash from the publicKey
    const computedPubKeyHash = bitcoin.crypto.hash160(publicKey);

    console.log('Computed Public Key Hash (Hex):', computedPubKeyHash.toString('hex'));
    console.log('Embedded Hash in scriptPubKey (Hex):', embeddedHash.toString('hex'));

    if (!computedPubKeyHash.equals(embeddedHash)) {
      throw new Error('Public key hash does not match the scriptPubKey.');
    }
    console.log('Public key hash matches the scriptPubKey!');

    // 7) Recreate the transaction hash for the sighash type
    const txHash = tx.hashForSignature(inputIndex, spkBuf, hashType);

    // 8) Verify the signature
    const keyPair = ECPair.fromPublicKey(publicKey, { network: dogecoinNetwork });
    const isValid = keyPair.verify(txHash, signature);

    if (isValid) {
      console.log('Signature verification succeeded!');
    } else {
      console.log('Signature verification failed.');
    }

  } catch (err) {
    console.error('Error verifying signature:', err.message);
  }
}

// Example usage:
const rawTxHex =
  '01000000013ef1cce4f7e8addcf5f5896e89da2aac7661d471c944e78f80a47c8938078205000000006a4730440220302e2844546d714b6d4b5e5cf8ede384ff9bd110ddd102158d86fa104f920d5302204ffda812249fc8b7b885312c7302dd3d57eeb8b70e029dc0b7aa3a1147ddc85b01210233c70a81caf97dd605a5ac92791b65f467001adf36e201b6d9442b1e76be10ccffffffff020027b929000000001976a914a7dcce4bf35b50dbe9da38e5dc6758b7ab78ae5a88ac0000000000000000416a3f746c30303b313b323b333b342c316d76616a35386c69696135316d653975753963673276796e746c7534376734347766316537717175387a39736a3464386600000000';

const inputIndex = 0;
const scriptPubKeyHex = '76a914a7dcce4bf35b50dbe9da38e5dc6758b7ab78ae5a88ac';

verifySignature(rawTxHex, inputIndex, scriptPubKeyHex);
