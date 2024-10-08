const baseConverter = require('bigint-base-converter');

// Define the Base 94 character set
const base94Chars = [
    ...Array(94).keys()
].map((i) => String.fromCharCode(i + 33));

// Create a map for decoding
const base94CharMap = Object.fromEntries(base94Chars.map((char, index) => [char, index]));

// Convert decimal to base 94
function toBase94(decimalString) {
    return baseConverter(decimalString, 10, base94Chars.join(''));
}

// Convert base 94 back to decimal
function fromBase94(base94String) {
    return baseConverter(base94String, base94Chars.join(''), 10);
}

// Helper functions for converting hex to decimal and back
function hexToDecimal(hex) {
    return BigInt('0x' + hex).toString();
}

function decimalToHex(decimalString) {
    return BigInt(decimalString).toString(16);
}

// Convert a hexadecimal string to Base 94
function hexToBase94(hex) {
    const decimalString = hexToDecimal(hex);
    return toBase94(decimalString);
}

// Convert a Base 94 string back to hexadecimal
function base94ToHex(base94String) {
    const decimalString = fromBase94(base94String);
    return decimalToHex(decimalString);
}

// Example usage:
const hex = 'eb06a8b414df86d70de3a0390fbc3e1b78598bcb51f67d33dba01d61954c2aa0';
const base94Encoded = hexToBase94(hex);
console.log(`Base 94 Encoded: ${base94Encoded}`);

const decodedHex = base94ToHex(base94Encoded);
console.log(`Decoded back to Hex: ${decodedHex}`);

// Confirming it matches original hex
console.log(`Match Original Hex: ${decodedHex === hex}`);
