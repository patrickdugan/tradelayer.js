const baseConverter = require('bigint-base-converter');

// Define the Custom Base 256 Character Set
const allCharacters = [...Array(65536).keys()].map(i => String.fromCharCode(i));
const customBase256Chars = allCharacters.filter(
    char => !/[\s\u0000-\u001F\u007F-\u00A0\u00AD\u2028\u2029]/.test(char)
).slice(0, 256);

// Ensure we have exactly 256 characters
if (customBase256Chars.length !== 256) {
    return new Error("Character set must contain exactly 256 unique, usable characters.");
}

// Create the converter object for custom Base 256
const Base256Converter = {
    // Convert decimal to custom Base 256
    toBase256(decimalString) {
        return baseConverter(decimalString, 10, customBase256Chars.join(''));
    },

    // Convert custom Base 256 back to decimal
    fromBase256(base256String) {
        return baseConverter(base256String, customBase256Chars.join(''), 10);
    },

    // Convert hex to decimal
    hexToDecimal(hex) {
        return BigInt('0x' + hex).toString();
    },

    // Convert decimal to hex
    decimalToHex(decimalString) {
        return BigInt(decimalString).toString(16);
    },

    // Convert hex to custom Base 256
    hexToBase256(hex) {
        const decimalString = this.hexToDecimal(hex);
        return this.toBase256(decimalString);
    },

    // Convert custom Base 256 back to hex
    base256ToHex(base256String) {
        const decimalString = this.fromBase256(base256String);
        return this.decimalToHex(decimalString);
    }
};

// Export the object for use in other modules
module.exports = Base256Converter;
