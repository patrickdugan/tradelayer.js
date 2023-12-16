const hexString = "808479860";

function hexToBytes(hex) {
    let bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}

function bytesToInteger(bytes) {
    return bytes.reduce((total, currentByte) => total * 256 + currentByte, 0);
}

function integerToBase36(integer) {
    return integer.toString(36);
}

const bytes = hexToBytes(hexString);
const integer = bytesToInteger(bytes);
const base36String = integerToBase36(integer);

console.log("Hex:", hexString);
console.log("Bytes:", bytes);
console.log("Integer:", integer);
console.log("Base36 String:", base36String);
