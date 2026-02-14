const crypto = require('crypto');
const secp = require('tiny-secp256k1');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function createOracleSigner() {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!secp.isPrivate(priv));
  const pubkey = Buffer.from(secp.pointFromScalar(priv, true)).toString('hex');
  return {
    pubkeyHex: pubkey,
    signBundle(bundle) {
      const canonicalObj = {
        eventId: String(bundle.eventId || ''),
        outcome: String(bundle.outcome || ''),
        outcomeIndex: Number(bundle.outcomeIndex || 0),
        stateHash: String(bundle.stateHash || ''),
        timestamp: Number(bundle.timestamp || 0)
      };
      if (bundle.payloadHash !== undefined && bundle.payloadHash !== null) {
        canonicalObj.payloadHash = String(bundle.payloadHash);
      }
      const canonical = JSON.stringify(canonicalObj);
      const hash = sha256(Buffer.from(canonical, 'utf8'));
      const sig = secp.sign(hash, priv);
      return {
        ...bundle,
        oraclePubkeyHex: pubkey,
        signatureHex: Buffer.from(sig).toString('hex')
      };
    }
  };
}

module.exports = { createOracleSigner };
