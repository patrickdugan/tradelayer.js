// Encode the transaction to base 256
function encodeOmniTransaction(type, params) {
  const payload = [type];

  switch (type) {
    case 1:
      payload.push(params.type);
      payload.push(params.initialAmount);
      payload.push(params.ticker);
      payload.push(params.whitelists || 0);
      break;
    case 2:
      payload.push(params.propertyId);
      payload.push(params.amount);
      break;
    case 3:
      payload.push(params.propertyId);
      payload.push(params.amount);
      payload.push(params.satsExpected);
      break;
    case 4:
      payload.push(params.propertyId);
      payload.push(params.amount);
      break;
    case 5:
      payload.push(params.propertyId);
      payload.push(params.propertyIdDesired);
      payload.push(params.amountOffered);
      payload.push(params.amountExpected);
      break;
    default:
      throw new Error("Unknown transaction type");
  }

  const encodedPayload = payload.map(num => num.toString(16).padStart(2, '0')).join('');
  return encodedPayload;
}

// Decode the base 256 payload to a transaction object
function decodeOmniTransaction(encodedPayload) {
  const type = parseInt(encodedPayload.substr(0, 2), 16);
  const params = {};

  const payloadData = encodedPayload.substr(2);

  switch (type) {
    case 1:
      params.type = parseInt(payloadData.substr(0, 2), 16);
      params.initialAmount = parseInt(payloadData.substr(2, 8), 16);
      params.ticker = payloadData.substr(10, 12);
      params.whitelists = parseInt(payloadData.substr(22, 2), 16);
      break;
    case 2:
      params.propertyId = parseInt(payloadData.substr(0, 8), 16);
      params.amount = parseInt(payloadData.substr(8, 8), 16);
      break;
    case 3:
      params.propertyId = parseInt(payloadData.substr(0, 8), 16);
      params.amount = parseInt(payloadData.substr(8, 8), 16);
      params.satsExpected = parseInt(payloadData.substr(16, 8), 16);
      break;
    case 4:
      params.propertyId = parseInt(payloadData.substr(0, 8), 16);
      params.amount = parseInt(payloadData.substr(8, 8), 16);
      break;
    case 5:
      params.propertyId = parseInt(payloadData.substr(0, 8), 16);
      params.propertyIdDesired = parseInt(payloadData.substr(8, 8), 16);
      params.amountOffered = parseInt(payloadData.substr(16, 8), 16);
      params.amountExpected = parseInt(payloadData.substr(24, 8), 16);
      break;
    default:
      throw new Error("Unknown transaction type");
  }

  return { type, params };
}

// Logic test: Check if the encoded payload is <= 40 bytes
function isPayloadSizeValid(encodedPayload) {
  return encodedPayload.length <= 40;
}

// Example Usage:
const tx = encodeOmniTransaction(1, {
  type: 1,
  initialAmount: 1000,
  ticker: "TOKEN",
  whitelists: 2,
});

console.log("Encoded Payload:", tx);
console.log("Is Payload Size Valid:", isPayloadSizeValid(tx));

const decodedTx = decodeOmniTransaction(tx);
console.log("Decoded Transaction:", decodedTx);
