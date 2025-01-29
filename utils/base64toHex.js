// Base64 to Hex Decoder
const base64ToHex = (base64String) => {
    try {
        // Decode base64 to a buffer
        const buffer = Buffer.from(base64String, 'base64');
        // Convert buffer to hex
        const hexString = buffer.toString('hex');
        return hexString;
    } catch (error) {
        console.error('Error decoding base64 to hex:', error);
        return null;
    }
};

// Example usage
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the Base64 string: ', (base64String) => {
    const hexResult = base64ToHex(base64String.trim());
    if (hexResult) {
        console.log('Hexadecimal Output:');
        console.log(hexResult);
    } else {
        console.log('Failed to convert the input to hex.');
    }
    rl.close();
});
