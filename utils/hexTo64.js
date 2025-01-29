const fs = require('fs');

function hexToBase64(hex) {
    // Convert hex to a buffer, then encode it to base64
    const buffer = Buffer.from(hex, 'hex');
    return buffer.toString('base64');
}

// Example usage
const hexString = '010000000148a578b5c7aae54b1f33f480d992054371884ba8efe3fb4f9f7f7dd2ffc8a932000000006a47304402206f0318f343860c21ea1ede8b3186b5b5da8448d313da0fa04ad4144388730ee0022062d0466bf1e844db42b448d8a78050e3a86413fa9f8d6209f5a6897c9c9b177c012102b72f530678baac030e896f5f6b1ffaf334dea4b10c8aff3923a335053f43ce93ffffffff020065cd1d000000001976a914be98d27a5fc1fb73d7cb487da7d56d49feacfd3588ac0000000000000000406a3e746c30303b313b323b333b342c33356735726a31343972776d71367835356567703730757867717239396c769c6f3661366433316b7a6163676a3762313900000000';

const base64String = hexToBase64(hexString);
console.log('Base64:', base64String);

// Optionally, write the base64 string to a file for easy transcription
fs.writeFileSync('output_base64.txt', base64String);
