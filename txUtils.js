// Import the necessary library for interacting with Litecoin
const Litecoin = require('litecoin'); // Replace with actual library import
const async = require('async')
const util = require('util');
const litecore = require('bitcore-lib-ltc');
const COIN = 100000000
const STANDARD_FEE = 10000; // Standard fee in LTC
const client = new Litecoin.Client({
    host: '127.0.0.1',
    port: 18332,
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

// Promisify the necessary client functions
const getRawTransactionAsync = util.promisify(client.getRawTransaction.bind(client));
const createRawTransactionAsync = util.promisify(client.createRawTransaction.bind(client));
const listUnspentAsync = util.promisify(client.cmd.bind(client, 'listunspent'));
const decoderawtransactionAsync = util.promisify(client.cmd.bind(client, 'decoderawtransaction'));
const signrawtransactionwithwalletAsync = util.promisify(client.cmd.bind(client, 'signrawtransactionwithwallet'));
const dumpprivkeyAsync = util.promisify(client.cmd.bind(client, 'dumpprivkey'))
const sendrawtransactionAsync = util.promisify(client.cmd.bind(client,'sendrawtransaction'))
const DUST_THRESHOLD= 54600

const TxUtils = {
    async getRawTransaction(txId) {
        try {
            // Use the promisified version of getRawTransaction
            return await getRawTransactionAsync(txId, true); // true for verbose mode
        } catch (error) {
            console.error(`Error fetching transaction ${txId}:`, error);
            throw error;
        }
    },

    async getSender(txId) {
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
                const satoshis = Math.round(referenceOutput.value * COIN); // Convert LTC to satoshis
                console.log(satoshis)
                return { address, satoshis };
            } else {
                throw new Error("Reference output not found");
            }
        } catch (error) {
            console.error(`Error in getReference for transaction ${txId}:`, error);
            throw error;
        }
    },

    async listUnspent(minconf, maxconf, addresses) {
        try {
            // Use the promisified version of listUnspent
            return await listUnspentAsync(minconf, maxconf, addresses);
        } catch (error) {
            console.error(`Error listing UTXOs:`, error);
            throw error;
        }
    },

    async decoderawtransaction(hexString) {
        try {
            // Use the promisified version of decoderawtransaction
            return await decoderawtransactionAsync(hexString);
        } catch (error) {
            console.error(`Error decoding raw transaction:`, error);
            throw error;
        }
    },

    async signrawtransactionwithwallet(rawTx) {
        try {
            // Use the promisified version of signrawtransactionwithwallet
            return await signrawtransactionwithwalletAsync(rawTx);
        } catch (error) {
            console.error(`Error signing raw transaction with wallet:`, error);
            throw error;
        }
    },

    async getPayload(txId) {
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
        } catch (error) {
            console.error(`Error in getPayload for transaction ${txId}:`, error);
            throw error;
        }
    },

    async getAdditionalInputs(txId) {
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

    async setSender(address, requiredAmount) {
        // First, get UTXOs for the specific address
        let utxos = await listUnspentAsync('listunspent', 0, 9999999, [address]);

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

     async createRawTransaction(inputs, outputs, locktime = 0, replaceable = false) {
    const transaction = new litecore.Transaction();

    for (const input of inputs) {
        // Fetch the raw transaction to which this input refers
        const tx = await this.getRawTransaction(input.txid);
        const utxo = tx.vout[input.vout];
        const scriptPubKey = utxo.scriptPubKey.hex;
        const value = Math.round(utxo.value*COIN)
        console.log(value)
        // Add UTXO to the transaction
        transaction.from({
            txId: input.txid,
            outputIndex: input.vout,
            script: scriptPubKey,
            satoshis: value // Convert LTC to satoshis
        });
    }

        // Add outputs
        outputs.forEach(output => {
            if (output.address) {
                transaction.to(output.address, output.amount * COIN); // Convert LTC to satoshis
                console.log(output.amount*COIN)
            }
            // Handle data (OP_RETURN) outputs
            else if (output.data) {
                const script = litecore.Script.buildDataOut(output.data, 'hex');
                transaction.addOutput(new litecore.Transaction.Output({ script: script, satoshis: 0 }));
            }
        });

        // Set locktime if specified
        if (locktime > 0) {
            transaction.lockUntilDate(locktime);
        }

        return transaction;
    },

    addPayload(payload, rawTx) {
        const transaction = new litecore.Transaction(rawTx);
        const script = litecore.Script.buildDataOut('tl' + payload, 'hex');
        transaction.addOutput(new litecore.Transaction.Output({ script: script, satoshis: 0 }));
        return transaction.toString();
    },

    async setChange(senderAddress, amount, rawTx) {
            const transaction = new litecore.Transaction(rawTx);

            // Log the transaction's inputs and outputs for debugging
            console.log("Transaction inputs:", transaction.inputs);
            console.log("Transaction outputs:", transaction.outputs);

            // Calculate change amount
            const inputAmount = transaction.inputs.reduce((sum, input) => {
                console.log("Current input:", input); // Log each input
                return sum + (input.output ? input.output.satoshis : 0);
            }, 0);

            const outputAmount = transaction.outputs.reduce((sum, output) => {
                console.log("Current output:", output); // Log each output
                return sum + output.satoshis;
            }, 0);

            const changeAmount = inputAmount - outputAmount - (STANDARD_FEE * 1e8); // Convert LTC to satoshis

            // Log the calculated change amount
            console.log("Calculated change amount (in satoshis):", changeAmount);

            // Add change output if above dust threshold
            if (changeAmount > DUST_THRESHOLD * 1e8) {
                transaction.change(senderAddress);
            }

            return transaction.serialize();
    },



    signTransaction(rawTx, privateKey) {
        const transaction = new litecore.Transaction(rawTx);
        const privateKeyObj = new litecore.PrivateKey(privateKey);
        transaction.sign(privateKeyObj);
        return transaction.toString();
    },

    async beginRawTransaction(txid, vout) {
        try {
            // Specify the input using txid and vout
            const inputs = [{
                txid: txid,
                vout: vout
            }];

            // Define a minimal set of outputs, can be an empty object for now
            const outputs = {};

            // Create the raw transaction
            const rawTx = await this.createRawTransaction(inputs, [outputs]);

            return rawTx;
        } catch (error) {
            console.error(`Error in createRawTransaction:`, error);
            throw error;
        }
    },


    async addInputs(utxos, rawTx) {
        // Decode the raw transaction to modify it
        let decodedTx = await decoderawtransactionAsync('decoderawtransaction', rawTx);

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

    async constructInitialTradeTokenTx(params, senderChannel) {
        // Retrieve the UTXO for the senderChannel address
        const utxos = await listUnspentAsync('listunspent', 0, 9999999, [senderChannel]);
        if (utxos.length === 0) {
            throw new Error('No UTXOs found for the sender channel address');
        }
        // Select the appropriate UTXO (e.g., based on criteria like highest amount or specific logic)
        const selectedUtxo = utxos[0]; // Simple selection logic, adjust as needed

        // Update params with the chosen UTXO details
        params.channelUtxo = {
            txid: selectedUtxo.txid,
            vout: selectedUtxo.vout
        };

        // Create the OP_RETURN payload
        let payload = "tl3";
        payload += Encoding.encodeTradeTokenForUTXO({
            ...params,
            // Include the reference address if needed
            referenceAddress: senderChannel // or another address if required
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
    },

   async finalizeTradeTokenTx(initialRawTx, additionalParams) {
        // additionalParams might include additionalUtxos, buyerChangeAddress, referenceAddress, etc.

        // Add additional UTXO inputs for UTXO consideration
        let rawTx = await addInputs(additionalParams.additionalUtxos, initialRawTx);

        // Add a change output for the UTXO spender/buyer
        rawTx = await setChange(additionalParams.buyerChangeAddress, additionalParams.buyerChangeAmount, rawTx);

        // Add the reference output, ensuring it matches the address in the OP_RETURN payload
        // (Assuming the logic to add a standard output is similar to setChange)
        rawTx = await setChange(additionalParams.referenceAddress, additionalParams.referenceAmount, rawTx);

        // Re-sign the transaction to include the new inputs and outputs
        let signedTx = await client.cmd('signrawtransactionwithwallet', rawTx);

        // Return the fully constructed and signed raw transaction
        return signedTx;
    },


    async parseAndCoSignMultisigTransaction(rawTx, expectedUTXOValue, coSignerAddress, coSignerPrivateKey, network) {
        // Step 1: Decode the raw transaction
        const decodedTx = await TxUtils.decodeRawTransaction(rawTx, network);

        // Step 2: Analyze the transaction outputs to find the reference/payment address and its value
         // Step 2: Analyze the transaction outputs to find the reference/payment address and its value
    // The reference output is the last output before the OP_RETURN or null data output
        let paymentOutputIndex = decodedTx.vout.findIndex(output => output.scriptPubKey.type === 'nulldata');
        if (paymentOutputIndex === -1 || paymentOutputIndex === 0) {
            throw new Error('No OP_RETURN output found or no outputs before OP_RETURN');
        }
        let paymentOutput = decodedTx.vout[paymentOutputIndex - 1]; // Getting the output before OP_RETURN

        if (!paymentOutput || paymentOutput.value < expectedUTXOValue) {
            throw new Error('Transaction does not meet the expected UTXO value criteria');
        }

        // Step 3: If the transaction is valid, prepare to co-sign it
        // Fetch additional UTXOs for the coSignerAddress if necessary
        const additionalUTXOs = await TxUtils.getAdditionalUTXOs(coSignerAddress, expectedUTXOValue - paymentOutput.value, network);

        // Step 4: Add the additional UTXOs to the transaction
        rawTx = await TxUtils.addInputsToTransaction(rawTx, additionalUTXOs, network);

        // Step 5: Co-sign the transaction
        const coSignedTx = await TxUtils.coSignTransaction(rawTx, coSignerPrivateKey, network);

        // Step 6: Optionally, you can broadcast the transaction
        // const txId = await TxUtils.broadcastTransaction(coSignedTx, network);

        return coSignedTx; // Return the co-signed transaction
    },

   async sendTransaction(fromAddress, toAddress, amount, opReturnData = null) {
        try {
            // Get private key for the fromAddress
            const privateKey = await dumpprivkeyAsync(fromAddress);

            // Adjust the amount to be at least the DUST_THRESHOLD if it is lower
            if (amount > 0 && amount < DUST_THRESHOLD) {
                amount = DUST_THRESHOLD;
            }

            // Find a suitable UTXO
            const minAmountSatoshis = amount + STANDARD_FEE;
            const utxo = await this.findSuitableUTXO(fromAddress, minAmountSatoshis);

            // Create the transaction
            let transaction = new litecore.Transaction().from(utxo).fee(STANDARD_FEE);

            // If toAddress is not null, add the to output
            if (toAddress) {
                transaction.to(toAddress, amount);
            }

            // Add change address
            transaction.change(fromAddress);

            // Add OP_RETURN data if provided
            if (opReturnData) {
                transaction.addData(opReturnData);
            }

            // Sign the transaction
            transaction.sign(privateKey);

            // Serialize and send the transaction
            const serializedTx = transaction.serialize();
            const txid = await sendrawtransactionAsync(serializedTx);
            return txid;
        } catch (error) {
            console.error('Error in sendTransaction:', error);
            throw error;
        }
    },



    async findSuitableUTXO(address, minAmount) {
        
        const utxos = await listUnspentAsync(0, 9999999, [address]);
        const suitableUtxo = utxos.find(utxo => (utxo.amount * COIN >= minAmount) && (utxo.amount * COIN >= DUST_THRESHOLD));
        console.log(suitableUtxo)
        if (!suitableUtxo) {
            throw new Error('No suitable UTXO found.');
        }

        return {
            txId: suitableUtxo.txid,
            outputIndex: suitableUtxo.vout,
            address: suitableUtxo.address,
            script: suitableUtxo.scriptPubKey,
            satoshis: Math.round(suitableUtxo.amount * 1e8) // Convert LTC to satoshis
        };
    }

};

module.exports = TxUtils;