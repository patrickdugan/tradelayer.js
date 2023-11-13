f// Encode the transaction to base 256
function encodeOmniTransaction(type, params) {
  const payload = [type];

  switch (type) {
    case 1:
      payload.push(params.initialAmount.toString(36)); // Convert integer to hex
      payload.push(params.ticker);
      payload.push(params.whitelists.map(val => val.toString(36)).join(',')); // Convert integers to hex and join with commas
      break;
    case 2:
      payload.push(params.propertyId.toString(36)); // Convert integer to hex
      payload.push(params.amount.toString(36)); // Convert integer to hex
      break;
    case 3:
      payload.push(params.propertyId.toString(36)); // Convert integer to hex
      payload.push(params.amount.toString(36)); // Convert integer to hex
      payload.push(params.satsExpected.toString(36)); // Convert integer to hex
      break;
    case 4:
      payload.push(params.propertyId.toString(36)); // Convert integer to hex
      payload.push(params.amount.toString(36)); // Convert integer to hex
      break;
    case 5:
      payload.push(params.propertyId.toString(36)); // Convert integer to hex
      payload.push(params.propertyIdDesired.toString(36)); // Convert integer to hex
      payload.push(params.amountOffered.toString(36)); // Convert integer to hex
      payload.push(params.amountExpected.toString(36)); // Convert integer to hex
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

  const type = parseInt(parts[0], 16); // Parse the type as a hex integer
  const params = {};

  let index = 1;

  switch (type) {
    case 1:
      params.initialAmount = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.ticker = parts[index];
      index++;
      params.whitelists = [];
      while (index < parts.length) {
        params.whitelists.push(parseInt(parts[index], 36)); // Convert hex to integer
        index++;
      }
      break;
    case 2:
      params.propertyId = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.amount = parseInt(parts[index], 36); // Convert hex to integer
      break;
    case 3:
      params.propertyId = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.amount = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.satsExpected = parseInt(parts[index], 36); // Convert hex to integer
      break;
    case 4:
      params.propertyId = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.amount = parseInt(parts[index], 36); // Convert hex to integer
      break;
    case 5:
      params.propertyId = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.propertyIdDesired = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.amountOffered = parseInt(parts[index], 36); // Convert hex to integer
      index++;
      params.amountExpected = parseInt(parts[index], 36); // Convert hex to integer
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

// Function to prepend "tl" marker to encoded payload
function prependTlMarker(encodedPayload) {
  return `tl${encodedPayload}`;
}

// Test Cases
const tx1 = encodeOmniTransaction(1, {
  propertyId: 12342,
  initialAmount: 10000.557964,
  ticker: "TOKEN",
  whitelists: [122, 234, 612, 1212312]
});

const encodedPayloadWithMarker1 = prependTlMarker(tx1);

const tx2 = encodeOmniTransaction(2, {
  propertyId: 54321,
  amount: 87654321.00000000,
});

const encodedPayloadWithMarker2 = prependTlMarker(tx2);

const tx3 = encodeOmniTransaction(3, {
  propertyId: 98765,
  amount: 12345678.00000000,
  satsExpected: 8765432,
});

const encodedPayloadWithMarker3 = prependTlMarker(tx3);

const tx4 = encodeOmniTransaction(4, {
  propertyId: 13579,
  amount: 246813579.00000000,
});

const encodedPayloadWithMarker4 = prependTlMarker(tx4);

const tx5 = encodeOmniTransaction(5, {
  propertyId: 11111,
  propertyIdDesired: 99999,
  amountOffered: 123456789.00000000,
  amountExpected: 87654322334.00000000,
});

const encodedPayloadWithMarker5 = prependTlMarker(tx5);

// Display Test Results
console.log("Encoded Transaction 1:", encodedPayloadWithMarker1);
console.log("Is Transaction 1 Payload Size Valid:", isPayloadSizeValid(encodedPayloadWithMarker1));
console.log("Decoded Transaction 1:", decodeOmniTransaction(encodedPayloadWithMarker1).params);

console.log("Encoded Transaction 2:", encodedPayloadWithMarker2);
console.log("Is Transaction 2 Payload Size Valid:", isPayloadSizeValid(encodedPayloadWithMarker2));
console.log("Decoded Transaction 2:", decodeOmniTransaction(encodedPayloadWithMarker2).params);

console.log("Encoded Transaction 3:", encodedPayloadWithMarker3);
console.log("Is Transaction 3 Payload Size Valid:", isPayloadSizeValid(encodedPayloadWithMarker3));
console.log("Decoded Transaction 3:", decodeOmniTransaction(encodedPayloadWithMarker3).params);

console.log("Encoded Transaction 4:", encodedPayloadWithMarker4);
console.log("Is Transaction 4 Payload Size Valid:", isPayloadSizeValid(encodedPayloadWithMarker4));
console.log("Decoded Transaction 4:", decodeOmniTransaction(encodedPayloadWithMarker4).params);

console.log("Encoded Transaction 5:", encodedPayloadWithMarker5);
console.log("Is Transaction 5 Payload Size Valid:", isPayloadSizeValid(encodedPayloadWithMarker5));
console.log("Decoded Transaction 5:", decodeOmniTransaction(encodedPayloadWithMarker5).params);
