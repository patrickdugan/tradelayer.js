// Import the encoding functions from txEncoder.js
const Encode = require('./txEncoder'); // Update the path to your txEncoder.js file

// Function to encode a payload based on the transaction ID and parameters
function encodePayload(transactionId, params) {
  let payload = transactionId.toString(36);

  switch (transactionId) {
    case 1:
      payload += Encode.encodeSimpleTokenIssue(params);
      break;
    case 2:
      payload += Encode.encodeSimpleSend(params);
      break;
    case 3:
      payload += Encode.encodeTradeTokenForUTXO(params);
      break;
    case 4:
      payload += Encode.encodeCommitToken(params);
      break;
    case 5:
      payload += Encode.encodeOnChainTokenForToken(params);
      break;
    case 6:
      payload += Encode.encodeCreateWhitelist(params);
      break;
    case 7:
      payload += Encode.encodeUpdateWhitelistAdmin(params);
      break;
    case 8:
      payload += Encode.encodeIssueAttestation(params);
      break;
    case 9:
      payload += Encode.encodeRevokeAttestation(params);
      break;
    case 10:
      payload += Encode.encodeCreateManagedToken(params);
      break;
    case 11:
      payload += Encode.encodeGrantManagedToken(params);
      break;
    case 12:
      payload += Encode.encodeRedeemManagedToken(params);
      break;
    case 13:
      payload += Encode.encodeUpdateManagedTokenAdmin(params);
      break;
    case 14:
      payload += Encode.encodeCreateOracle(params);
      break;
    case 15:
      payload += Encode.encodePublishOracleData(params);
      break;
    case 16:
      payload += Encode.encodeUpdateOracleAdmin(params);
      break;
    case 17:
      payload += Encode.encodeCloseOracle();
      break;
    case 18:
      payload += Encode.encodeCreateOracleFutureContract(params);
      break;
    case 19:
      payload += Encode.encodeExerciseDerivative(params);
      break;
    case 20:
      payload += Encode.encodeNativeContractWithOnChainData(params);
      break;
    default:
      throw new Error('Unknown transaction type');
  }

  return payload;
}

// Import the decoding functions from txDecoder.js
const Decode = require('./txDecoder'); // Update the path to your txDecoder.js file

// Function to decode a payload based on the transaction ID and encoded payload
function decodePayload(transactionId, encodedPayload) {
  let index = 0;
  let params = {};

  if (encodedPayload.startsWith(transactionId.toString(36))) {
    index = (transactionId.toString(36)).length;
  } else {
    throw new Error('Invalid payload');
  }

  switch (transactionId) {
    case 1:
      params = Decode.decodeSimpleTokenIssue(encodedPayload.substr(index));
      break;
    case 2:
      params = Decode.decodeSimpleSend(encodedPayload.substr(index));
      break;
    case 3:
      params = Decode.decodeTradeTokenForUTXO(encodedPayload.substr(index));
      break;
    // ... other cases ...
    default:
      throw new Error('Unknown transaction type');
  }

  return params;
}

module.exports = decodePayload;


module.exports = encodePayload;
