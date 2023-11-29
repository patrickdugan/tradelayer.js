const Litecoin = require('litecoin'); // Replace with actual library import
const util = require('util');
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const decoderawtransactionAsync = util.promisify(client.cmd.bind(client));

async function testDecodeRawTransaction(rawTx) {
    try {
        const decodedTx = await decoderawtransactionAsync('decoderawtransaction', rawTx);
        console.log('Decoded Transaction:', decodedTx);

        const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

        if (opReturnOutput) {
            const opReturnData = opReturnOutput.scriptPubKey.hex;
            console.log('OP_RETURN Data:', opReturnData);

            // Extract and log the "tl" marker
            const markerHex = opReturnData.substring(6, 10); // '746c' for 'tl'
            const marker = Buffer.from(markerHex, 'hex').toString();
            console.log('Marker:', marker);

            // Extract and log the actual payload
            const payloadHex = opReturnData.substring(10);
            const payload = Buffer.from(payloadHex, 'hex').toString();
            console.log('Decoded Payload:', payload);

            return { marker, payload };
        } else {
            console.log('No OP_RETURN output found.');
            return null;
        }
    } catch (error) {
        console.error('Error decoding raw transaction:', error);
    }
}

const rawTx = '0200000001c54ddd5eff707218be1f2f063c4f6668f1e65280d72104729b24b68d7db4db570100000000ffffffff010000000000000000086a066a746c302c3000000000';
testDecodeRawTransaction(rawTx);
