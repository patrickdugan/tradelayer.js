const baseConverter = require('bigint-base-converter');

// Define the Base 94 character set
const base94Chars = [...Array(94).keys()].map((i) => String.fromCharCode(i + 33));

// Create the conversion functions within an object
const Base94Converter = {
    // Convert decimal to base 94
    toBase94(decimalString) {
        return baseConverter(decimalString, 10, base94Chars.join(''));
    },

    // Convert base 94 back to decimal
    fromBase94(base94String) {
        return baseConverter(base94String, base94Chars.join(''), 10);
    },

    // Convert hex to decimal
    hexToDecimal(hex) {
        return BigInt('0x' + hex).toString();
    },

    // Convert decimal to hex
    decimalToHex(decimalString) {
        return BigInt(decimalString).toString(16);
    },

    // Convert hex to Base 94
    hexToBase94(hex) {
        const decimalString = this.hexToDecimal(hex);
        return this.toBase94(decimalString);
    },

    // Convert Base 94 back to hex
    base94ToHex(base94String) {
        const decimalString = this.fromBase94(base94String);
        return this.decimalToHex(decimalString);
    },

    // Convert decimal to Base 94 including fractional parts
    decimalToBase94(decimal) {
        const [integerPart, fractionalPart] = decimal.toString().split('.');
        const integerEncoded = this.toBase94(integerPart);

        // Encode fractional part by scaling it
        let fractionalEncoded = '';
        if (fractionalPart) {
            const scale = Math.pow(10, fractionalPart.length);
            const scaledFraction = BigInt(fractionalPart) * BigInt(scale) / BigInt('1' + '0'.repeat(fractionalPart.length));
            fractionalEncoded = this.toBase94(scaledFraction.toString()) + '_'; // Using underscore as fractional separator
        }

        return `${integerEncoded}.${fractionalEncoded}`;
    }
};

// Export the object for use in other modules
module.exports = Base94Converter;