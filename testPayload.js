const { Buffer } = require('buffer');

/**
 * Pushes bytes to the end of a buffer.
 */
 function pushBackBytes(buffer, value) {
    if (Array.isArray(value)) {
        buffer.push(...value);
    } else if (Buffer.isBuffer(value)) {
        buffer.push(value);
    } else {
        console.error(`ERROR: Invalid value type for pushBackBytes: ${typeof value}`);
    }
}

//000000000000000000000000020000000000000000989680
//00000000000000020000000000989680

/**
 * Returns a buffer of bytes containing the version and hash160 for an address.
 */
function addressToBytes(address) {
    const addressBytes = Buffer.from(address, 'base256');
    if (addressBytes.length === 25) {
        return addressBytes.slice(0, 21); // truncate checksum
    } else {
        console.error(`ERROR: unexpected size when decoding address ${address}.`);
        return Buffer.alloc(0);
    }
}

function createPayload_SimpleSend(propertyId, amount) {
    const payload = [];
    const messageType = 0;
    const messageVer = 0;

    // messageVer (2 bytes, little-endian)
    payload.push(messageVer & 0xFF, (messageVer >> 8) & 0xFF);

    // messageType (2 bytes, little-endian)
    payload.push(messageType & 0xFF, (messageType >> 8) & 0xFF);

    // propertyId (4 bytes, little-endian)
    payload.push(
        propertyId & 0xFF,
        (propertyId >> 8) & 0xFF,
        (propertyId >> 16) & 0xFF,
        (propertyId >> 24) & 0xFF
    );

    // Convert amount from decimal string to 64-bit integer (8 bytes)
    let amountBigInt = BigInt(Math.round(parseFloat(amount) * 1e8)); // Assuming 8 decimal places
    let amountBuffer = Buffer.alloc(8);
    for (let i = 7; i >= 0; i--) {
        amountBuffer.writeUInt8(Number(amountBigInt & BigInt(0xFF)), i);
        amountBigInt >>= BigInt(8);
    }

    payload.push(...amountBuffer);

    return Buffer.from(payload);
}




// Define other payload creation functions similarly...

const propertyId = 2;
const amount = '0.1';
const payload = createPayload_SimpleSend(propertyId, amount);
console.log(payload.toString('hex'));
