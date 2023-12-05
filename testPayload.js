function testPayloadSeparation(hexPayload) {
    // Decode from hex to plaintext
    const asmBuffer = new Buffer(hexPayload, "hex");
    const message =  asmBuffer.toString();
    console.log(message);
    // Assuming the payload format is 'tlXX' where XX are digits
    if (!plaintextPayload.startsWith('tl')) {
        throw new Error('Invalid payload');
    }

    const marker = plaintextPayload.substring(0, 2); // 'tl'
    const restOfPayload = plaintextPayload.substring(2); // '00' in this case

    const transactionId = restOfPayload.charAt(0); // First '0'
    const otherData = restOfPayload.substring(1); // Second '0'

    console.log(`Marker: ${marker}`);
    console.log(`Transaction ID: ${transactionId}`);
    console.log(`Other Data: ${otherData}`);
}

// Example usage
testPayloadSeparation('808479860');
