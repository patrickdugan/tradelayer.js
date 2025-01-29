const axios = require('axios');

/**
 * Broadcasts a Dogecoin transaction using the Tatum API.
 * 
 * @param {string} txHex - The raw transaction hex string (signed).
 * @param {string} apiKey - Your Tatum API key.
 */
async function broadcastDogecoinTransaction(txHex, apiKey) {
    const apiUrl = 'https://api.tatum.io/v3/dogecoin/broadcast';

    try {
        // Prepare the payload
        const payload = {
            txData: txHex
        };

        // Send the POST request to the Tatum API
        const response = await axios.post(apiUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey // Set your API key in the headers
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
        if (error.response) {
            console.error("API Response Error:", error.response.data);
        } else {
            console.error("Error:", error.message);
        }
    }
}

// Example Usage
const txHex = "010000000144e79a17f16d5226251ecd920f2f1f32f3757f37e97c75eb47c9cec84bf44451000000006b483045022100a6ea0b1cd9b404030a53fcee8b445a8026bc8337b67d254c77cd7ef4a0193ad30220045f771a506a0b3ddb0dea03379754bf0e2a166ed3a02793c7ef7e7f062eeceb0121034480f60d0010d92fb3e35516e4ddef458c0f7405010afce931488ed1c0570ba6ffffffff02a0d0ad04000000001976a914226eae66f1d4da7f47015be99d1c4e2484e39b9c88ac0000000000000000336a31746c32303b44374e64505a4b4d6e4d6f3970646d4a696b3135544c4443534e39725842464e4d613b313b62776f336b3b3000000000"; // Replace with your signed transaction hex
const apiKey = "t-6796b068758217afa9cf49ca-93175dba4b9545f3be960d83"; // Replace with your Tatum API key
broadcastDogecoinTransaction(txHex, apiKey);
