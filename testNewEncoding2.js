// Encode the transaction to base 256
function encodeOmniTransaction(type, params) {
  const payload = [type];

  switch (type) {
    case 1:
      payload.push(params.initialAmount.toString(16)); // Convert integer to hex
      payload.push(params.ticker);
      payload.push(params.whitelists || 0);
      break;
    case 2:
      payload.push(params.propertyId.toString(16)); // Convert integer to hex
      payload.push(params.amount.toString(16)); // Convert integer to hex
      break;
    case 3:
      payload.push(params.propertyId.toString(16)); // Convert integer to hex
      payload.push(params.amount.toString(16)); // Convert integer to hex
      payload.push(params.satsExpected.toString(16)); // Convert integer to hex
      break;
    case 4:
      payload.push(params.propertyId.toString(16)); // Convert integer to hex
      payload.push(params.amount.toString(16)); // Convert integer to hex
      break;
    case 5:
      payload.push(params.propertyId.toString(16)); // Convert integer to hex
      payload.push(params.propertyIdDesired.toString(16)); // Convert integer to hex
      payload.push(params.amountOffered.toString(16)); // Convert integer to hex
      payload.push(params.amountExpected.toString(16)); // Convert integer to hex
      break;
    default:
      throw new Error("Unknown transaction type");
  }

  // Join all the elements of the payload into a single string, separated by commas
  const encodedPayload = payload.join(',');

  return encodedPayload;
}

// Decode the base 256 payload to a transaction object
function decodeOmniTransaction(encodedPayload) {
  if (encodedPayload.startsWith("tl")) {
    encodedPayload = encodedPayload.substr(2); // Remove the "tl" marker
  }

  const parts = encodedPayload.split(',');

  const type = parseInt(parts[0], 10); // Parse the type as a regular integer
  const params = {};

  let index = 1;

  switch (type) {
    case 1:
      params.initialAmount = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.ticker = parts[index];
      index++;
      params.whitelists = parts.slice(index).map(value => parseInt(value, 10));
      break;
    case 2:
      params.propertyId = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.amount = parseInt(parts[index], 16); // Convert hex to integer
      break;
    case 3:
      params.propertyId = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.amount = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.satsExpected = parseInt(parts[index], 16); // Convert hex to integer
      break;
    case 4:
      params.propertyId = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.amount = parseInt(parts[index], 16); // Convert hex to integer
      break;
    case 5:
      params.propertyId = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.propertyIdDesired = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.amountOffered = parseInt(parts[index], 16); // Convert hex to integer
      index++;
      params.amountExpected = parseInt(parts[index], 16); // Convert hex to integer
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
  propertyId: 12342,
  initialAmount: 10000557964,
  ticker: "TOKEN",
  whitelists: [122, 234, 612, 1212312]
});

const encodedPayloadWithMarker = `tl${tx}`; // Prepend "tl" marker

console.log("Encoded Payload with Marker:", encodedPayloadWithMarker);
console.log("Is Payload Size Valid:", isPayloadSizeValid(encodedPayloadWithMarker));

const decodedTx = decodeOmniTransaction(encodedPayloadWithMarker.substr(2)); // Remove the "tl" marker when decoding
console.log("Decoded Transaction:", decodedTx);
