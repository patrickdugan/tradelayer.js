const baseConverter = require('bigint-base-converter');

// Define the Base 94 character set
const base94Chars = [...Array(94).keys()].map((i) => String.fromCharCode(i + 33));

// Convert decimal integer part to base 94
function toBase94(decimalString) {
    return baseConverter(decimalString, 10, base94Chars.join(''));
}

// Helper function to handle decimal encoding
function decimalToBase94(decimal) {
    const [integerPart, fractionalPart] = decimal.toString().split('.');

    // Encode integer part
    const integerEncoded = toBase94(integerPart);

    // Encode fractional part by scaling it
    let fractionalEncoded = '';
    if (fractionalPart) {
        const scale = Math.pow(10, fractionalPart.length); // scale to integer
        const scaledFraction = BigInt(fractionalPart) * BigInt(scale) / BigInt('1' + '0'.repeat(fractionalPart.length));
        fractionalEncoded = toBase94(scaledFraction.toString()) + '_'; // Use a separator for fractional part
    }

    return `${integerEncoded}.${fractionalEncoded}`;
}

// Example usage:
const decimal = 34232;
const base94Encoded = decimalToBase94(decimal);
console.log(`Base 94 Encoded: ${base94Encoded}`);
