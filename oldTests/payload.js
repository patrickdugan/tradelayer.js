const tokenIdentifier = 2;
const amount = "0.1";

// Convert the token identifier to a 4-byte hexadecimal string
const tokenIdentifierHex = tokenIdentifier.toString(16).padStart(8, "0");

// Convert the amount to a 8-byte hexadecimal string (assuming 8 bytes for the amount)
const amountHex = (Math.floor(parseFloat(amount) * 1e8)).toString(16).padStart(16, "0");

// Combine the token identifier and amount as a payload
const payload = tokenIdentifierHex + amountHex;

console.log(payload);