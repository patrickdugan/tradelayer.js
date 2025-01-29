const axios = require('axios');

/**
 * Broadcasts a signed Dogecoin transaction to the Dogecoin network.
 * 
 * @param {string} txHex - The raw transaction hex string (signed).
 * @param {string} apiUrl - The API endpoint for broadcasting the transaction.
 */
async function broadcastDogecoinTransaction(txHex, apiUrl = 'https://sochain.com/api/v2/send_tx/DOGE') {
    try {
        // Prepare the payload
        const payload = {
            tx_hex: txHex
        };

        // Make the POST request to the API
        const response = await axios.post(apiUrl, payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Check if the broadcast was successful
        if (response.status === 200) {
            console.log("Transaction broadcasted successfully!");
            console.log("Response:", response.data);
        } else {
            console.error(`Failed to broadcast transaction. Status Code: ${response.status}`);
            console.error("Response:", response.data);
        }
    } catch (error) {
        console.error("An error occurred while broadcasting the transaction:", error.message);
    }
}

// Example Usage
const txHex = "01000000014ceac2bf9640e751498dded188c6b9bb494ddbbbcc8f4fc30b620a583c49867a0000000000ffffffff02c071b504000000001976a914226eae66f1d4da7f47015be99d1c4e2484e39b9c88ac0000000000000000336a31746c32303b44366e4e6e5069384743477a536178375148644246576b48397454477a68746642383b313b68763035633b3000000000"; // Replace with your signed transaction hex
broadcastDogecoinTransaction(txHex);
