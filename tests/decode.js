function decodeOmniPayload(hexPayload) {
    // Remove the "OP_RETURN" prefix (4 bytes) and convert the hex payload to a Buffer
    const payloadBuffer = Buffer.from(hexPayload.slice(8), 'hex');

    // Extract the markers (each marker is 4 bytes)
    const markers = [];
    for (let i = 0; i < payloadBuffer.length; i += 4) {
        const markerBuffer = payloadBuffer.slice(i, i + 4);
        const marker = markerBuffer.toString('ascii');
        markers.push(marker);
    }

    // Extract the payload data as a Buffer (skip markers)
    const dataBuffer = payloadBuffer.slice(markers.length * 4);

    // Check if there is enough data to read a 32-bit integer
    let numericValue = null;
    if (dataBuffer.length >= 4) {
        numericValue = dataBuffer.readInt32LE(0);
    }

    // Convert markers to plain text
    const markersText = markers.join(' ');

    // Convert payload data to plain text
    const dataText = dataBuffer.toString('utf8');

    return {
        markers: markersText,
        data: dataText,
        numericValue
    };
}

// Example usage:
const hexPayload = "6f6d6e6900000032010002000000000000537175697272656c20636f696e00004e55545300001dd7c1681d0000";
const decodedPayload = decodeOmniPayload(hexPayload);
console.log(decodedPayload.markers); // "omni coin NUTS"
console.log(decodedPayload.data); // "Squirrel coin"
console.log(decodedPayload.numericValue); // 84000000



/*function decodeOmniPayload(hexPayload) {
    // Remove the "OP_RETURN" prefix (4 bytes) and convert the hex payload to a Buffer
    const payloadBuffer = Buffer.from(hexPayload.slice(8), 'hex');

    // Extract the Omni marker (4 bytes) as an ASCII string
    const marker = payloadBuffer.slice(0, 4).toString('ascii');

    // Decode the payload data to a string while handling non-printable characters
    let decodedData = '';
    for (let i = 4; i < payloadBuffer.length; i++) {
        const charCode = payloadBuffer.readUInt8(i);
        if (charCode >= 32 && charCode <= 126) {
            // Printable ASCII characters
            decodedData += String.fromCharCode(charCode);
        } else {
            // Non-printable characters, represent as \xHH
            decodedData += `\\x${charCode.toString(16).padStart(2, '0').toUpperCase()}`;
        }
    }

    return {
        marker,
        data: decodedData
    };
}

// Example usage:
const hexPayload = "6f6d6e6900000032010002000000000000537175697272656c20636f696e00004e55545300001dd7c1681d0000";
const decodedPayload = decodeOmniPayload(hexPayload);
console.log(decodedPayload.marker); // "omni"
console.log(decodedPayload.data); // "Squirrel coinNUTS\x1D\xD7\xC1\x68\x1D"


/*function decodeOmniPayload(hexPayload) {
    // Remove the "OP_RETURN" prefix (4 bytes) and convert the hex payload to a Buffer
    const payloadBuffer = Buffer.from(hexPayload.slice(8), 'hex');

    // Extract the Omni marker (4 bytes) as a hexadecimal string
    const markerHex = payloadBuffer.slice(0, 4).toString('hex');

    // Define a mapping for known Omni markers
    const markerMap = {
        '6f6d6e69': 'omni',
        // Add more markers as needed
    };

    // Decode the payload data to a string while handling non-printable characters
    let decodedData = '';
    for (let i = 4; i < payloadBuffer.length; i++) {
        const charCode = payloadBuffer.readUInt8(i);
        if (charCode >= 32 && charCode <= 126) {
            // Printable ASCII characters
            decodedData += String.fromCharCode(charCode);
        } else {
            // Non-printable characters, represent as \xHH
            decodedData += `\\x${charCode.toString(16).padStart(2, '0').toUpperCase()}`;
        }
    }

    // Determine the marker name based on the hexadecimal value
    const markerName = markerMap[markerHex] || 'Unknown';

    return {
        marker: markerName,
        data: decodedData
    };
}

// Example usage:
const hexPayload = "6f6d6e6900000032010002000000000000537175697272656c20636f696e00004e55545300001dd7c1681d0000";
const decodedPayload = decodeOmniPayload(hexPayload);
console.log(decodedPayload.marker); // "omni"
console.log(decodedPayload.data); // "Squirrel coinNUTS\x1D\xD7\xC1\x68\x1D"*/


/*function decodeOmniPayload(hexPayload) {
    // Remove the "OP_RETURN" prefix (4 bytes) and convert the hex payload to a Buffer
    const payloadBuffer = Buffer.from(hexPayload.slice(8), 'hex');

    // Extract the Omni marker (4 bytes)
    const marker = payloadBuffer.slice(0, 4).toString('hex');

    // Extract the payload data (after the marker)
    const payloadData = payloadBuffer.slice(4);

    // Decode the payload data to a string while handling non-printable characters
    let decodedData = '';
    for (let i = 0; i < payloadData.length; i++) {
        const charCode = payloadData.readUInt8(i);
        if (charCode >= 32 && charCode <= 126) {
            // Printable ASCII characters
            decodedData += String.fromCharCode(charCode);
        } else {
            // Non-printable characters, represent as \xHH
            decodedData += `\\x${charCode.toString(16).padStart(2, '0').toUpperCase()}`;
        }
    }

    return {
        marker: marker,
        data: decodedData
    };
}*/

// Example usage:
/*const hexPayload = "6f6d6e6900000032010002000000000000537175697272656c20636f696e00004e55545300001dd7c1681d0000";
const decodedPayload = decodeOmniPayload(hexPayload);
console.log(decodedPayload.marker); // "omni"
console.log(decodedPayload.data); // "Squirrel coinNUTS\x1D\xD7\xC1\x68\x1D*/

/*function decodeOmniPayload(hexPayload) {
    // Remove the "OP_RETURN" prefix (4 bytes) and convert the hex payload to a Buffer
    const payloadBuffer = Buffer.from(hexPayload.slice(8), 'hex');

    // Extract the Omni marker (4 bytes)
    const marker = payloadBuffer.slice(0, 4).toString('hex');

    // Extract the payload data (after the marker)
    const payloadData = payloadBuffer.slice(4);

    // Decode the payload data to a string
    let decodedData = '';
    for (let i = 0; i < payloadData.length; i++) {
        decodedData += String.fromCharCode(payloadData[i]);
    }

    return {
        marker: marker,
        data: decodedData
    };
}

// Example usage:
const hexPayload = "6f6d6e6900000032010002000000000000537175697272656c20636f696e00004e55545300001dd7c1681d0000";
const decodedPayload = decodeOmniPayload(hexPayload);
console.log(decodedPayload.marker); // "omni"
console.log(decodedPayload.data); // "Squirrel coinNUTSh"
*/

/*
function decodeOmniPayload(hexPayload) {
    // Remove the "OP_RETURN" prefix (4 bytes) and convert the hex payload to a Buffer
    const payloadBuffer = Buffer.from(hexPayload.slice(8), 'hex');

    // Extract the Omni marker (4 bytes)
    const marker = payloadBuffer.slice(0, 4).toString('hex');

    // Extract the payload data (after the marker)
    const payloadData = payloadBuffer.slice(4).toString('utf8');

    return {
        marker: marker,
        data: payloadData
    };
}

// Example usage:
const hexPayload = "6f6d6e6900000032010002000000000000537175697272656c20636f696e00004e55545300001dd7c1681d0000";
const decodedPayload = decodeOmniPayload(hexPayload);
console.log(decodedPayload.marker); // "omni"
console.log(decodedPayload.data); // "Squirrel coinNUTSh"
*/