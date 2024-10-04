const BigNumber = require('bignumber.js');

// Function to encode using BigNumber and base-36
function encodeTradeTokenForUTXO(params) {
    console.log('--- Encoding ---');
    console.log('Input Amount:', params.amountOffered);

    // Use BigNumber for precision and convert to base-36
    const amount = new BigNumber(params.amountOffered).toString(36);
    console.log('Amount in base-36:', amount);

    const payload = [
        params.propertyId.toString(36),
        amount,
        params.columnA ? '1' : '0',
        params.satsExpected.toString(36),
        params.tokenOutput.toString(36),
        params.payToAddress.toString(36)
    ];

    console.log('Encoded Payload:', payload.join(','));
    return payload.join(',');
}

// Function to decode back to original value
function decodeTradeTokenForUTXO(payload) {
    console.log('--- Decoding ---');
    console.log('Payload:', payload);

    const parts = payload.split(',');

    // Decode the amount using BigNumber and base-36
    const amount = new BigNumber(parts[1], 36).toNumber();
    console.log('Decoded Amount:', amount);

    return {
        propertyId: parseInt(parts[0], 36),
        amount: amount, // This should now return the correct value
        columnA: parts[2] === '1',
        satsExpected: parseInt(parts[3], 36),
        tokenOutput: parseInt(parts[4], 36),
        payToAddress: parseInt(parts[5], 36)
    };
}

// Test with the 0.1 that is causing issues in the larger codebase
const testInput = {
    propertyId: 1,
    amountOffered: 0.1,
    columnA: true,
    satsExpected: 1000,
    tokenOutput: 2,
    payToAddress: 3
};

// Encode the test input
console.log('Encoding test input...');
const encoded = encodeTradeTokenForUTXO(testInput);

// Decode it back to see if we get the original values
console.log('Decoding test input...');
const decoded = decodeTradeTokenForUTXO(encoded);

console.log('--- Final Decoded Object ---');
console.log(decoded);
