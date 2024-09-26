function testDecode(opReturnData){
	
            // Check if the hex contains the marker "746c" (which corresponds to "tl")
            let markerHex = "746c"; // Hex for "tl"
            let payloadStart = 8;
            let markerPosition = opReturnData.indexOf(markerHex); // Check if the marker is anywhere in the string
            if (markerPosition === -1 || markerPosition > 6) {
                console.log('Marker "tl" not found or in an invalid position.');
                return null;
            } else if (markerHex === opReturnData.substring(4, 8)) {
                payloadStart = 8;
            } else if (markerHex === opReturnData.substring(5, 9)) {
                payloadStart = 9;
            } else if (markerHex === opReturnData.substring(6, 10)) {
                payloadStart = 10;
            }

            // Extract and log the actual payload
            const payloadHex = opReturnData.substring(payloadStart);
            const payload = Buffer.from(payloadHex, 'hex').toString();
            console.log(`Marker: ${markerHex}, Payload: ${payload}`);

            if (markerHex === '746c') {
                console.log('Pre-decoded and Decoded Payload:', opReturnData + ' ' + payload);
            }

            return { marker: 'tl', payload, decodedTx };
}

payload= ''