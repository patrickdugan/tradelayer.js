const baseConverter = require('bigint-base-converter');

// Define the Base 94 character set
const base94Chars = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33));
//console.log(base94Chars); // Should print valid ASCII printable characters


// Create the conversion functions within an object
const Base94Converter = {
    // Convert decimal to base 94
    toBase94(decimalString) {
        return baseConverter(decimalString, 10, base94Chars.join(''));
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

    validateBase94Input(input) {
        for (const char of input) {
            if (!base94Chars.includes(char)) {
                throw new Error(`Invalid Base94 character detected: ${char}`);
            }
        }
    },

   decimalToBase94(decimal) {
        if (!decimal) return null; // Validate input

        const [integerPart, fractionalPart] = decimal.toString().split('.');
        console.log('integer part '+integerPart)
        const integerEncoded = this.toBase94(integerPart);

        let fractionalEncoded = '';
        if (fractionalPart) {
            const scale = Math.pow(10, fractionalPart.length);
            const scaledFraction = BigInt(fractionalPart) * BigInt(scale) / BigInt('1' + '0'.repeat(fractionalPart.length));
            fractionalEncoded = this.toBase94(scaledFraction.toString());
        }

        return fractionalPart ? `${integerEncoded}|${fractionalEncoded}` : integerEncoded;
    },

    fromBase94(base94String) {
        if (!base94String) return null; // Validate input

        const [integerEncoded, fractionalEncoded] = base94String.split('|');
        const integerDecoded = this.fromBase94(integerEncoded);
        let fractionalDecoded = '0';

        if (fractionalEncoded) {
            fractionalDecoded = BigInt(this.fromBase94(fractionalEncoded)).toString();
        }

        return `${integerDecoded}.${fractionalDecoded}`;
    }

};

// Export the object for use in other modules
module.exports = Base94Converter;