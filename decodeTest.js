const Litecoin = require('litecoin'); // Replace with actual library import
const util = require('util');
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const decoderawtransactionAsync = util.promisify(client.cmd.bind(client,'decoderawtransaction'));
const getTransactionAsync = util.promisify(client.cmd.bind(client, 'gettransaction'))

async function testDecodeRawTransaction(rawTx) {
    try {
        const decodedTx = await decoderawtransactionAsync('decoderawtransaction', rawTx);
        console.log('Decoded Transaction:', decodedTx);

        const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

        if (opReturnOutput) {
            const opReturnData = opReturnOutput.scriptPubKey.hex;
            console.log('OP_RETURN Data:', opReturnData);

            // Extract and log the "tl" marker
            const markerHex = opReturnData.substring(4, 8); // '746c' for 'tl'
            const marker = Buffer.from(markerHex, 'hex').toString();
            console.log('Marker:', marker);

            // Extract and log the actual payload
            const payloadHex = opReturnData.substring(8);
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

const rawTx = '02000000000101be64c98a4c17b5861b45b2602873212cb0ada374539c7b61593b2d3e47b8e5cd0100000000ffffffff020000000000000000066a04746c303080b9ff0600000000160014ebecd536259ef21bc6ecc18e45b35412f04722900247304402201ac4b0e373e7555d502e80b5424683dd1da2ca8052793bd2c62d64b2e9370367022014e72b32507262b3c78848b81558acfb2c9f9cb2a8c7968b65615888e7f04d0b012103d6521aea309f7a2768a1cabcb917664966cabc28bc23874b12f73c1989972c5f00000000';
client.cmd('gettransaction','0513576fa72ffdd721176dfc5a971af50958102070f55fce6d50aa604c6d0cb0',function(err,data){
    console.log(data.hex)
    testDecodeRawTransaction(data.hex);
})
