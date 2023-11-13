// Import the necessary library for interacting with Litecoin
const Litecoin = require('litecoin'); // Replace with actual library import

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 8332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

const TxUtils = {
    async function getRawTransaction(txId) {
        try {
            return await client.getRawTransaction(txId, true); // true for verbose mode
        } catch (error) {
            console.error(`Error fetching transaction ${txId}:`, error);
            throw error;
        }
    },

    async function getSender(txId) {
        const tx = await this.getRawTransaction(txId);
        if (!tx || !tx.vin || tx.vin.length === 0) {
            throw new Error(`Invalid transaction data for ${txId}`);
        }

        const vin = tx.vin[0]; // Assuming we're only interested in the first input
        if (!vin.txid) {
            throw new Error(`No previous transaction reference in input for ${txId}`);
        }

        const parentTx = await this.getRawTransaction(vin.txid);
        if (!parentTx || !parentTx.vout || parentTx.vout.length <= vin.vout) {
            throw new Error(`Invalid parent transaction data for ${vin.txid}`);
        }

        const output = parentTx.vout[vin.vout];
        if (!output || !output.scriptPubKey || !output.scriptPubKey.addresses) {
            throw new Error(`No output found for vin ${vin.vout} in transaction ${vin.txid}`);
        }

        const senderAddress = output.scriptPubKey.addresses[0]; // Assuming single address
        const amount = output.value; // Amount in LTC

        return { senderAddress, amount };
    },

    async getReference(txId) {
        try {
            const tx = await this.getRawTransaction(txId);
            if (!tx || !tx.vout) {
                throw new Error(`Invalid transaction data for ${txId}`);
            }

            let referenceOutput = null;

            // Iterate over outputs to find the last non-OP_RETURN output
            for (let i = tx.vout.length - 1; i >= 0; i--) {
                const output = tx.vout[i];
                if (output.scriptPubKey.type !== 'nulldata') { // 'nulldata' type is typically used for OP_RETURN
                    referenceOutput = output;
                    break;
                }
            }

            if (referenceOutput) {
                const address = referenceOutput.scriptPubKey.addresses[0]; // Assuming single address
                const satoshis = Math.round(referenceOutput.value * 1e8); // Convert LTC to satoshis
                return { address, satoshis };
            } else {
                throw new Error("Reference output not found");
            }
        } catch (error) {
            console.error(`Error in getReference for transaction ${txId}:`, error);
            throw error;
        }
    },

    async function getPayload(txId) {
        try {
            const tx = await this.getRawTransaction(txId);
            if (!tx || !tx.vout) {
                throw new Error(`Invalid transaction data for ${txId}`);
            }

            for (const output of tx.vout) {
                // Check if the output's script type is 'nulldata', which is used for OP_RETURN
                if (output.scriptPubKey.type === 'nulldata') {
                    // The actual payload data is typically in the 'asm' part of the scriptPubKey
                    // It's usually hex-encoded, so you might need to convert it from hex to a string
                    const payloadData = output.scriptPubKey.asm;
                    return payloadData;
                }
            }

            throw new Error("Payload not found in transaction");
        } catch (error) {
            console.error(`Error in getPayload for transaction ${txId}:`, error);
            throw error;
        }
    },

    async function getAdditionalInputs(txId) {
        try {
            const tx = await this.getRawTransaction(txId);
            if (!tx || !tx.vin || tx.vin.length <= 1) {
                return []; // No additional inputs beyond the first
            }

            let additionalInputs = [];
            for (let i = 1; i < tx.vin.length; i++) { // Start from second input
                const input = tx.vin[i];

                if (!input.txid) {
                    throw new Error(`No previous transaction reference in input for ${txId}`);
                }

                const parentTx = await this.getRawTransaction(input.txid);
                if (!parentTx || !parentTx.vout || parentTx.vout.length <= input.vout) {
                    throw new Error(`Invalid parent transaction data for ${input.txid}`);
                }

                const output = parentTx.vout[input.vout];
                if (!output || !output.scriptPubKey || !output.scriptPubKey.addresses) {
                    throw new Error(`No output found for vin ${input.vout} in transaction ${input.txid}`);
                }

                const address = output.scriptPubKey.addresses[0]; // Assuming single address
                const amount = output.value; // Amount in LTC

                additionalInputs.push({ address, amount });
            }

            return additionalInputs;
        } catch (error) {
            console.error(`Error in getAdditionalInputs for transaction ${txId}:`, error);
            throw error;
        }
    },

    async function setSender(address, requiredAmount) {
        // First, get UTXOs for the specific address
        let utxos = await client.cmd('listunspent', 0, 9999999, [address]);

        // Sort UTXOs by amount, descending
        utxos.sort((a, b) => b.amount - a.amount);

        let selectedUtxos = [];
        let totalAmount = 0;

        // Try to meet the required amount with UTXOs from the specified address
        for (let utxo of utxos) {
            selectedUtxos.push(utxo);
            totalAmount += utxo.amount;
            if (totalAmount >= requiredAmount) {
                return selectedUtxos;
            }
        }

        // If not enough, get all UTXOs in the wallet
        let allUtxos = await client.cmd('listunspent', 0, 9999999);
        // Exclude UTXOs already selected
        allUtxos = allUtxos.filter(utxo => !selectedUtxos.includes(utxo));

        // Sort the remaining UTXOs by amount, descending
        allUtxos.sort((a, b) => b.amount - a.amount);

        // Add additional UTXOs from the wallet
        for (let utxo of allUtxos) {
            if (utxo.address !== address) { // Ensure UTXOs from the specified address are first
                selectedUtxos.push(utxo);
                totalAmount += utxo.amount;
                if (totalAmount >= requiredAmount) {
                    break;
                }
            }
        }

        // Check if the total amount is still insufficient
        if (totalAmount < requiredAmount) {
            throw new Error('Insufficient funds: Total UTXOs amount is less than the required amount');
        }

        return selectedUtxos;
    },

    async function addInputs(utxos, rawTx) {
        // Decode the raw transaction to modify it
        let decodedTx = await client.cmd('decoderawtransaction', rawTx);

        // Add each UTXO as an input
        utxos.forEach(utxo => {
            decodedTx.vin.push({
                txid: utxo.txid,
                vout: utxo.vout
            });
        });

        // Re-encode the transaction
        return await client.cmd('createrawtransaction', decodedTx.vin, decodedTx.vout);
    },

    async function addPayload(payload, rawTx) {
        // Decode the raw transaction
        let decodedTx = await client.cmd('decoderawtransaction', rawTx);

        // Convert payload to a format suitable for OP_RETURN (typically hex-encoded)
        const encodedPayload = /* encode payload as necessary */;

        // Add OP_RETURN output
        decodedTx.vout.push({
            "value": 0.0,
            "scriptPubKey": {
                "type": "nulldata",
                "hex": "6a" + encodedPayload // '6a' is OP_RETURN in hex
            }
        });

        // Re-encode the transaction
        return await client.cmd('createrawtransaction', decodedTx.vin, decodedTx.vout);
    },


    async function setChange(address, amount, rawTx) {
    // Decode the raw transaction
    let decodedTx = await client.cmd('decoderawtransaction', rawTx);

    // Add a change output
    decodedTx.vout.push({
        "value": amount,
        "scriptPubKey": {
            "address": address
        }
    });

    // Re-encode the transaction
    return await client.cmd('createrawtransaction', decodedTx.vin, decodedTx.vout);
    }


    async function constructInitialTradeTokenTx(params,senderChannel) {
        // params might include propertyId, amount, satsExpected, channelUtxo, etc.

        // Create the OP_RETURN payload

        const payload = "tl3" 
        payload+=Encoding.encodeTradeTokenForUTXO({
            ...params,
        });

        // Create the transaction with the channel address as the first input
        let rawTx = await client.cmd('createrawtransaction', [[{
            txid: params.channelUtxo.txid,
            vout: params.channelUtxo.vout
        }], []]);

        // Add the OP_RETURN payload
        rawTx = await addPayload(payload, rawTx);

        // Add a change output for the token seller
        rawTx = await setChange(params.sellerChangeAddress, params.sellerChangeAmount, rawTx);

        // Sign the transaction
        let signedTx = await client.cmd('signrawtransactionwithwallet', rawTx);

        // Return the partially constructed and signed raw transaction
        return signedTx;
    }

    async function constructTradeTokenTx(params) {
    // params include propertyId, amount, satsExpected, etc.
    
    // Implement the transaction construction logic as per the described rules
    // This involves creating inputs, outputs, setting the payload, and validating the transaction structure
    }



    // ... additional functions to build transactions will be added here ...
};

module.exports = TxUtils;