const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function hexToBase58(hexStr) {
    let num = BigInt('0x' + hexStr);
    let base58 = '';
    while (num > 0) {
        const div = num / BigInt(BASE58_ALPHABET.length);
        const mod = num % BigInt(BASE58_ALPHABET.length);
        base58 = BASE58_ALPHABET[Number(mod)] + base58;
        num = div;
    }
    // Add '1' for each leading '00' byte as per Base58 encoding
    for (let i = 0; hexStr[i] === '0' && i < hexStr.length - 1; i += 2) {
        base58 = '1' + base58;
    }
    return base58;
}

function base58ToHex(base58Str) {
    let num = BigInt(0);
    for (let char of base58Str) {
        const charIndex = BASE58_ALPHABET.indexOf(char);
        if (charIndex < 0) {
            throw new Error(`Invalid character found: ${char}`);
        }
        num = num * BigInt(BASE58_ALPHABET.length) + BigInt(charIndex);
    }
    let hex = num.toString(16);
    // Add '00' for each leading '1' as per Base58 encoding
    for (let i = 0; base58Str[i] === '1' && i < base58Str.length - 1; i++) {
        hex = '00' + hex;
    }
    // Ensure even length for the hex string
    if (hex.length % 2) {
        hex = '0' + hex;
    }
    return hex.toUpperCase();
}

// Example usage
const hexValue = 'd745ac8daf473ba7d7f9dc2d426beca18af97ba53f1f0e143761782c65c6cffe';
const base58Value = hexToBase58(hexValue);
const convertedBackHex = base58ToHex(base58Value);

console.log('Hex:', hexValue);
console.log('Base58:', base58Value);
console.log('Converted Back Hex:', convertedBackHex);
