const baseConverter = require('bigint-base-converter');

// Define the Base 94 character set
const base94Chars = [...Array(94).keys()].map((i) => String.fromCharCode(i + 33));

// Convert a decimal string to base 94
function toBase94(decimalString) {
    return baseConverter(decimalString, 10, base94Chars.join(''));
}

// Convert hexadecimal (base16) string to base94
function hexToBase94(hex) {
    // Convert the hexadecimal string to a decimal string
    const decimalString = BigInt(`0x${hex}`).toString(10);

    // Convert the decimal string to base94
    return toBase94(decimalString);
}

// Example usage:
const hex = '540016785dec88efdc71ebbf13d9c8c690100c9f776c6e275cb1e2a19c27b983';
const base94Encoded = hexToBase94(hex);
console.log(`Base 94 Encoded: ${base94Encoded}`);
