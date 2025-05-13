
const litecore = require('bitcore-lib-ltc');
const Encode = require('./txEncoder.js');
const BigNumber = require('bignumber.js');
const Consensus = require('./consensus.js');
const clientPromise = require('./client').getInstance();  // Import the ClientWrapper instance
const COIN = 100000000;
const STANDARD_FEE = 10000; // Standard fee in LTC
const DUST_THRESHOLD = 54600;

const TxUtils = {
    async init() {
        this.client = await clientPromise;
    },

    async getRawTransaction(txid) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }
        try {
            const doc = await this.client.getRawTransaction(txid, true);
            //console.log(doc)
            return doc
        } catch (error) {
            console.error(`Error fetching transaction for txid ${txid}:`, error);
        }
    },

    async getTransaction(txid) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }
        try {
            const doc = await this.client.getTransaction(txid);
            //console.log(doc)
            return doc
        } catch (error) {
            console.error(`Error fetching transaction for txid ${txid}:`, error);
        }
    },

    async validateAddressWrapper(address) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }
        try {
            return await this.client.validateAddress(address);
        } catch (error) {
            console.error(`Error validating address ${address}:`, error);
        }
    },

    async addOPReturn(txBlob, payload) {
        return new litecore.Transaction(txBlob).addData(payload);
    },

    isRBF(tx){
        return tx.vin.some(input => input.sequence < 0xfffffffe);
    }


    async getBlockHeight(blockhash) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            const block = await this.client.getBlock(blockhash);
            return block.height;
        } catch (error) {
            console.error(`Error fetching block height for blockhash ${blockhash}:`, error);
        }
    },

    async getBlockCount() {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.getBlockCount();
        } catch (error) {
            console.error(`Error fetching block count:`, error);
        }
    },


    async getSender(txId) {
        let tx
        try{
            tx = await this.client.getRawTransaction(txId)
        }catch(err){
            console.log('err getting tx for sender'+err)
        }

        if (!tx || !tx.vin || tx.vin.length === 0) {
            return new Error(`Invalid transaction data for ${txId}`);
        }

        const vin = tx.vin[0]; // Assuming we're only interested in the first input
        if (!vin.txid) {
            return new Error(`No previous transaction reference in input for ${vin.txid}`);
        }
                //console.log('get sender tx id '+vin.txid)

        const parentTx = await this.client.getRawTransaction(vin.txid)
        if (!parentTx || !parentTx.vout || parentTx.vout.length <= vin.vout) {
            return new Error(`Invalid parent transaction data for ${vin.txid}`);
        }

        const output = parentTx.vout[vin.vout];
        if (!output || !output.scriptPubKey || !output.scriptPubKey.addresses) {
            return new Error(`No output found for vin ${vin.vout} in transaction ${vin.txid}`);
        }

        const senderAddress = output.scriptPubKey.addresses[0]; // Assuming single address
        const amount = output.value; // Amount in LTC
        //console.log(senderAddress,amount)
        return { senderAddress, amount };
    },


    async getReference(txId) {
        let tx
        try {
            tx = await this.client.getRawTransaction(txId, true);
            if (!tx || !tx.vout) {
                return new Error(`Invalid transaction data for ${txId}`);
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
                //console.log(satoshis)
                return { address, satoshis };
            } else {
                return new Error("Reference output not found");
            }
        } catch (error) {
            console.error(`Error in getReference for transaction ${txId}:`, error);
            return error;
        }
   },
 

    async loadWallet() {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.loadWallet('wallet.dat');
        } catch (error) {
            console.error('Error loading wallet:', error);
        }
    },

    async listUnspent(minConf, maxConf, addresses) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.listUnspent(minConf, maxConf, addresses);
        } catch (error) {
            console.error(`Error listing UTXOs for addresses ${addresses}:`, error);
        }
    },

    async signRawTransaction(rawTx) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.signrawtransactionwithwallet(rawTx);
        } catch (error) {
            console.error(`Error signing transaction:`, error);
        }
    },

    async sendRawTransaction(serializedTx) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.sendrawtransaction(serializedTx);
        } catch (error) {
            console.error(`Error sending transaction:`, error);
        }
    },

    // Add other functions here, replacing direct calls to client methods with the appropriate wrapped methods
    // Example:
    async getTransactionOutputs(txId) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            const tx = await this.client.getRawTransaction(txId);
            return tx.vout.map(output => ({
                address: output.scriptPubKey.addresses ? output.scriptPubKey.addresses[0] : null,
                satoshis: Math.round(output.value * COIN),
                vout: output.n
            })).filter(output => output.address);  // Filter out outputs without addresses (OP_RETURN)
        } catch (error) {
            console.error(`Error getting outputs for tx ${txId}:`, error);
        }
    },
 
    async getReferenceAddresses(txId) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            const tx = await this.client.getRawTransaction(txId, true); // Fetch the raw transaction data
            if (!tx || !tx.vout) {
                throw new Error(`Invalid transaction data for ${txId}`);
            }

            const referenceAddresses = [];
            for (let i = 0; i < tx.vout.length; i++) {
                const output = tx.vout[i];

                if (output.scriptPubKey.type === 'nulldata' && i > 0) {
                    const prevOutput = tx.vout[i - 1];
                    referenceAddresses.push(prevOutput.scriptPubKey.addresses[0]);
                } else if (output.value < (2 * DUST_THRESHOLD) / COIN) {
                    referenceAddresses.push(output.scriptPubKey.addresses[0]);
                }
            }

            return referenceAddresses.length > 0 ? referenceAddresses : new Error("No reference outputs found");
        } catch (error) {
            console.error(`Error in getReferenceAddresses for transaction ${txId}:`, error);
            return error;
        }
    },

    async listUnspent(minconf, maxconf, addresses) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.listUnspent(minconf, maxconf, addresses);
        } catch (error) {
            console.error(`Error listing UTXOs:`, error);
            return error;
        }
    },

    async decoderawtransaction(hexString) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.decoderawtransaction(hexString);
        } catch (error) {
            console.error(`Error decoding raw transaction:`, error);
            return error;
        }
    },

    async signrawtransactionwithwallet(rawTx) {
        if(!this.client){
            console.log('awaiting client in get raw tx')
            await init()
        }

        try {
            return await this.client.signrawtransactionwithwallet(rawTx);
        } catch (error) {
            console.error(`Error signing raw transaction with wallet:`, error);
            return error;
        }
    },

    async getPayload(rawTx) {
        if (!rawTx || !rawTx.vout) {
            console.error("Invalid transaction data or missing 'vout' property.");
            return null;
        }

        for (const output of rawTx.vout) {
            if (output.scriptPubKey.type === 'nulldata') {
                const payloadData = output.scriptPubKey.asm;
                console.log("Extracted payload: ", payloadData);
                return payloadData;
            }
        }

        console.log("No payload found in transaction.");
        return null;
    },

    async getAdditionalInputs(txId) {
        if(!this.client){
            console.log('awaitingthis.clientin get raw tx')
            await init()
        }
        try {
            const tx = await this.client.getRawTransaction(txId, true);
            if (!tx || !tx.vin || tx.vin.length <= 1) {
                return [];
            }

            let additionalInputs = [];
            for (let i = 1; i < tx.vin.length; i++) {
                const input = tx.vin[i];
                const parentTx = await client.getRawTransaction(input.txid, true);
                const output = parentTx.vout[input.vout];

                const address = output.scriptPubKey.addresses[0];
                const amount = output.value;

                additionalInputs.push({ address, amount });
            }

            return additionalInputs;
        } catch (error) {
            console.error(`Error in getAdditionalInputs for transaction ${txId}:`, error);
            return error;
        }
    },

    async setSender(address, requiredAmount) {
        try {
            if(!this.client){
                console.log('awaitingthis.clientin get raw tx')
                await init()
            }
            let utxos = await this.client.listUnspent(0, 9999999, [address]);
            utxos.sort((a, b) => b.amount - a.amount);

            let selectedUtxos = [];
            let totalAmount = 0;

            for (let utxo of utxos) {
                selectedUtxos.push(utxo);
                totalAmount += utxo.amount;
                if (totalAmount >= requiredAmount) {
                    return selectedUtxos;
                }
            }

            let allUtxos = await client.listUnspent(0, 9999999);
            allUtxos = allUtxos.filter(utxo => !selectedUtxos.includes(utxo)).sort((a, b) => b.amount - a.amount);

            for (let utxo of allUtxos) {
                if (utxo.address !== address) {
                    selectedUtxos.push(utxo);
                    totalAmount += utxo.amount;
                    if (totalAmount >= requiredAmount) break;
                }
            }

            if (totalAmount < requiredAmount) {
                throw new Error('Insufficient funds: Total UTXOs amount is less than the required amount');
            }

            return selectedUtxos;
        } catch (error) {
            console.error('Error in setSender:', error);
            return error;
        }
    },

    async createRawTransaction(inputs, outputs, locktime = 0, replaceable = false) {
        const transaction = new litecore.Transaction();

        for (const input of inputs) {
            const tx = await client.getRawTransaction(input.txid, true);
            const utxo = tx.vout[input.vout];
            transaction.from({
                txId: input.txid,
                outputIndex: input.vout,
                script: utxo.scriptPubKey.hex,
                satoshis: Math.round(utxo.value * COIN)
            });
        }

        outputs.forEach(output => {
            if (output.address) {
                transaction.to(output.address, output.amount * COIN);
            } else if (output.data) {
                const script = litecore.Script.buildDataOut(output.data, 'hex');
                transaction.addOutput(new litecore.Transaction.Output({ script: script, satoshis: 0 }));
            }
        });

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
    console.log("Transaction inputs:", transaction.inputs);
    console.log("Transaction outputs:", transaction.outputs);

    const inputAmount = transaction.inputs.reduce((sum, input) => {
        console.log("Current input:", input);
        return sum + (input.output ? input.output.satoshis : 0);
    }, 0);

    const outputAmount = transaction.outputs.reduce((sum, output) => {
        console.log("Current output:", output);
        return sum + output.satoshis;
    }, 0);

    const changeAmount = inputAmount - outputAmount - (STANDARD_FEE * 1e8);
    console.log("Calculated change amount (in satoshis):", changeAmount);

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
        const inputs = [{ txid: txid, vout: vout }];
        const outputs = {};
        const rawTx = await this.createRawTransaction(inputs, [outputs]);
        return rawTx;
    } catch (error) {
        console.error(`Error in createRawTransaction:`, error);
        return error;
    }
},

async addInputs(utxos, rawTx) {
    try {
        let decodedTx = await this.client.decoderawtransaction(rawTx);
        utxos.forEach(utxo => {
            decodedTx.vin.push({ txid: utxo.txid, vout: utxo.vout });
        });

        return await this.client.createRawTransaction(decodedTx.vin, decodedTx.vout);
    } catch (error) {
        console.error('Error in addInputs:', error);
        return error;
    }
},

    async constructInitialTradeTokenTx(params, senderChannel) {
        try {
            const utxos = await this.client.listUnspent(0, 9999999, [senderChannel]);
            if (utxos.length === 0) throw new Error('No UTXOs found for the sender channel address');

            const selectedUtxo = utxos[0];
            params.channelUtxo = { txid: selectedUtxo.txid, vout: selectedUtxo.vout };

            let payload = "tl3" + Encode.encodeTradeTokenForUTXO({ ...params, referenceAddress: senderChannel });
            let rawTx = await this.client.createRawTransaction([{ txid: params.channelUtxo.txid, vout: params.channelUtxo.vout }], []);
            
            rawTx = this.addPayload(payload, rawTx);
            rawTx = await this.setChange(params.sellerChangeAddress, params.sellerChangeAmount, rawTx);
            
            let signedTx = await this.client.signrawtransactionwithwallet(rawTx);
            return signedTx;
        } catch (error) {
            console.error('Error in constructInitialTradeTokenTx:', error);
            return error;
        }
    },

    async tradeUTXO(params, senderChannel, senderLTC) {
        try {
            const minConf = 0;
            const maxConf = 9999999;

            console.log('Fetching UTXOs for:', senderChannel, senderLTC);

            const utxosSender = await this.client.listUnspent(minConf, maxConf, [senderChannel]);
            const utxosBuyer = await this.client.listUnspent(minConf, maxConf, [senderLTC]);

            if (utxosSender.length === 0 || utxosBuyer.length === 0) {
                throw new Error('No UTXOs found for one or both addresses');
            }

            const selectedUtxoSender = utxosSender[0];
            const selectedUtxoBuyer = utxosBuyer[0];

            console.log('Selected UTXOs:', selectedUtxoSender, selectedUtxoBuyer);

            let payload = "tl3" + Encode.encodeTradeTokenForUTXO({
                ...params,
                referenceAddress: senderChannel,
            });

            let transaction = new litecore.Transaction()
                .from([selectedUtxoSender, selectedUtxoBuyer])
                .addData(payload)
                .fee(STANDARD_FEE);

            console.log('Calculating output values...');

            let totalInput = (selectedUtxoSender.amount + selectedUtxoBuyer.amount) * COIN;
            let requiredOutput = Math.floor(params.satsExpected);
            let remainingSats = totalInput - STANDARD_FEE - requiredOutput;

            if (remainingSats < 0) {
                throw new Error('Insufficient funds after subtracting the required output and fee.');
            }

            transaction.to(senderChannel, requiredOutput);

            let changeSender = Math.floor(selectedUtxoSender.amount * COIN) - (STANDARD_FEE / 2);
            let changeBuyer = Math.floor(selectedUtxoBuyer.amount * COIN) - (requiredOutput + (STANDARD_FEE / 2));

            transaction.to(senderChannel, changeSender);
            transaction.to(senderLTC, changeBuyer);

            console.log('Signing the transaction...');

            let privateKey1 = await client.dumpprivkey(senderChannel);
            let privateKey2 = await client.dumpprivkey(senderLTC);

            transaction.sign(privateKey1);
            transaction.sign(privateKey2);

            console.log('Serializing the transaction...');
            
            const serializedTx = transaction.serialize();
            const txid = await client.sendrawtransaction(serializedTx);
            console.log('Trade transaction sent:', txid);

            return txid;
        } catch (error) {
            console.error('Error in tradeUTXO:', error);
            throw error;
        }
    },

    async finalizeTradeTokenTx(initialRawTx, additionalParams) {
        try {
            let rawTx = await this.addInputs(additionalParams.additionalUtxos, initialRawTx);
            rawTx = await this.setChange(additionalParams.buyerChangeAddress, additionalParams.buyerChangeAmount, rawTx);
            rawTx = await this.setChange(additionalParams.referenceAddress, additionalParams.referenceAmount, rawTx);

            let signedTx = await this.client.signrawtransactionwithwallet(rawTx);
            return signedTx;
        } catch (error) {
            console.error('Error in finalizeTradeTokenTx:', error);
            return error;
        }
    },

    async parseAndCoSignMultisigTransaction(rawTx, expectedUTXOValue, coSignerAddress, coSignerPrivateKey, network) {
        try {
            const decodedTx = await this.client.decoderawtransaction(rawTx, network);
            let paymentOutputIndex = decodedTx.vout.findIndex(output => output.scriptPubKey.type === 'nulldata');
            
            if (paymentOutputIndex === -1 || paymentOutputIndex === 0) {
                return new Error('No OP_RETURN output found or no outputs before OP_RETURN');
            }

            let paymentOutput = decodedTx.vout[paymentOutputIndex - 1];

            if (!paymentOutput || paymentOutput.value < expectedUTXOValue) {
                return new Error('Transaction does not meet the expected UTXO value criteria');
            }

            const additionalUTXOs = await this.getAdditionalUTXOs(coSignerAddress, expectedUTXOValue - paymentOutput.value, network);
            rawTx = await this.addInputsToTransaction(rawTx, additionalUTXOs, network);

            const coSignedTx = await this.coSignTransaction(rawTx, coSignerPrivateKey, network);
            return coSignedTx;
        } catch (error) {
            console.error('Error in parseAndCoSignMultisigTransaction:', error);
            return error;
        }
    },

    async issuePropertyTransaction(fromAddress, initialAmount, ticker, whitelists, managed, backupAddress, nft) {
        try {
            const privateKey = await this.client.dumpprivkey(fromAddress);
            const minAmountSatoshis = STANDARD_FEE;
            const utxo = await this.findSuitableUTXO(fromAddress, minAmountSatoshis);

            let transaction = new litecore.Transaction().from(utxo).fee(STANDARD_FEE);
            transaction.change(fromAddress);

            let payload = 'tl1' + Encode.encodeTokenIssue({
                initialAmount: initialAmount,
                ticker: ticker,
                whitelists: whitelists,
                managed: managed,
                backupAddress: backupAddress,
                nft: nft
            });
            
            console.log('Preparing payload for property issuance:', payload);
            transaction.addData(payload);

            transaction.sign(privateKey);
            const serializedTx = transaction.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);
            console.log('Property issuance transaction sent:', txid);
            return txid;
        } catch (error) {
            console.error('Error in issuePropertyTransaction:', error);
            throw error;
        }
    },

    async tokenTradeTransaction(fromAddress, propertyIdOffered, propertyIdDesired, amountOffered, amountExpected) {
        try {
            const privateKey = await this.client.dumpprivkey(fromAddress);
            const minAmountSatoshis = STANDARD_FEE;
            const utxo = await this.findSuitableUTXO(fromAddress, minAmountSatoshis);

            let transaction = new litecore.Transaction().from(utxo).fee(STANDARD_FEE);
            transaction.change(fromAddress);

            let payload = 'tl5' + Encode.encodeOnChainTokenForToken({
                propertyIdOffered: propertyIdOffered,
                propertyIdDesired: propertyIdDesired,
                amountOffered: amountOffered,
                amountExpected: amountExpected
            });

            console.log('Preparing payload for token trade:', payload);
            transaction.addData(payload);

            transaction.sign(privateKey);
            const serializedTx = transaction.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);
            console.log('Token trade transaction sent:', txid);
            return txid;
        } catch (error) {
            console.error('Error in tokenTradeTransaction:', error);
            throw error;
        }
    },

    async sendTransaction(fromAddress, toAddress, propertyId, amount, sendAll) {
        try {
            const privateKey = await this.client.dumpprivkey(fromAddress);
            if (sendAll == null) sendAll = 0;

            const minAmountSatoshis = STANDARD_FEE;
            const utxo = await this.findSuitableUTXO(fromAddress, minAmountSatoshis);

            let transaction = new litecore.Transaction().from(utxo).fee(STANDARD_FEE);
            transaction.change(fromAddress);

            let payload = Encode.encodeSend({
                sendAll: sendAll,
                address: toAddress,
                propertyId: propertyId,
                amount: amount
            });

            console.log('Preparing payload:', payload);
            transaction.addData(payload);

            transaction.sign(privateKey);
            const serializedTx = transaction.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);
            console.log('Send transaction sent:', txid);

            return txid;
        } catch (error) {
            console.error('Error in sendTransaction:', error);
            return error;
        }
    },

    async activationTransaction(adminAddress, txTypeToActivate) {
        try {
            const codeHash = await Consensus.hashFiles()
            let activationPayload = Encode.encodeActivateTradeLayer({
                txTypeToActivate: txTypeToActivate,
                codeHash: codeHash
            });

            const utxos = await this.client.listUnspent(1, 9999999, [adminAddress]);
            console.log(utxos);
            if (utxos.length === 0) throw new Error('No UTXOs available for the admin address.');

            const minAmountSatoshis = STANDARD_FEE;
            const utxo = await this.findSuitableUTXO(adminAddress, minAmountSatoshis);

            let transaction = new litecore.Transaction().from(utxo)
                .addData(activationPayload)
                .change(adminAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(adminAddress);
            transaction.sign(privateKey);

            const serializedTx = transaction.uncheckedSerialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Activation transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in activationTransaction:', error);
            throw error;
        }
    },


   async createContractSeriesTransaction(thisAddress, contractParams) {
        try {
            var txNumber = 16;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeCreateFutureContractSeries(contractParams);

            const utxos = await this.client.listUnspent(1, 9999999, [thisAddress]);
            console.log(utxos);
            if (utxos.length === 0) throw new Error('No UTXOs available for the address');

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Create contract transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createContractSeriesTransaction:', error);
            throw error;
        }
    },

    async commitTransaction(fromAddress, toAddress, propertyId, amount, privateKey) {
        try {
            let transaction = new litecore.Transaction();

            const utxo = await this.findSuitableUTXO(fromAddress, STANDARD_FEE);
            transaction.from(utxo).fee(STANDARD_FEE).change(fromAddress);

            const payload = 'tl4' + Encode.encodeTradeCommitment({ toAddress, propertyId, amount });
            transaction.addData(payload);

            transaction.sign(privateKey);
            return transaction;
        } catch (error) {
            console.error('Error in commitTransaction:', error);
            throw error;
        }
    },

    async createGeneralTransaction(thisAddress, contractParams, txNumber) {
        try {
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeCreateFutureContractSeries(contractParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`General transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createGeneralTransaction:', error);
            throw error;
        }
    },

    async createOracleTransaction(thisAddress, contractParams) {
        try {
            var txNumber = 13;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeCreateOracle(contractParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            console.log('chosen utxo ' + JSON.stringify(utxo));
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.uncheckedSerialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Create Oracle transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createOracleTransaction:', error);
            throw error;
        }
    },

    async publishDataTransaction(thisAddress, contractParams) {
        try {
            var txNumber = 14;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodePublishOracleData(contractParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Oracle publish transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in publishDataTransaction:', error);
            throw error;
        }
    },

    async createContractOnChainTradeTransaction(thisAddress, contractParams) {
        try {
            var txNumber = 18;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeTradeContractOnchain(contractParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Contract on-chain trade transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createContractOnChainTradeTransaction:', error);
            throw error;
        }
    },

    async createCancelTransaction(thisAddress, cancelParams) {
        try {
            var txNumber = 6;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeCancelOrder(cancelParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Cancel transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createCancelTransaction:', error);
            throw error;
        }
    },

    async createCommitTransaction(thisAddress, commitParams) {
        try {
            var txNumber = 4;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeCommit(commitParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Commit transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createCommitTransaction:', error);
            throw error;
        }
    },

    async createWithdrawalTransaction(thisAddress, withdrawalParams) {
        try {
            var txNumber = 21;
            var payload = 'tl' + txNumber.toString(36);
            payload += Encode.encodeWithdrawal(withdrawalParams);

            const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
            const rawTx = new litecore.Transaction()
                .from(utxo)
                .addData(payload)
                .change(thisAddress)
                .fee(STANDARD_FEE);

            const privateKey = await this.client.dumpprivkey(thisAddress);
            rawTx.sign(privateKey);

            const serializedTx = rawTx.serialize();
            const txid = await this.client.sendrawtransaction(serializedTx);

            console.log(`Withdrawal transaction sent successfully. TXID: ${txid}`);
            return txid;
        } catch (error) {
            console.error('Error in createWithdrawalTransaction:', error);
            throw error;
        }
    },
async createChannelContractTradeTransaction(thisAddress, params) {
    try {
        var txNumber = 19;
        var payload = 'tl' + txNumber.toString(36);
        payload += Encode.encodeTradeContractChannel(params);

        const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
        const rawTx = new litecore.Transaction()
            .from(utxo)
            .addData(payload)
            .change(thisAddress)
            .fee(STANDARD_FEE);

        const privateKey = await this.client.dumpprivkey(thisAddress);
        rawTx.sign(privateKey);

        const serializedTx = rawTx.serialize();
        const txid = await this.client.sendrawtransaction(serializedTx);

        console.log(`Channel Contract Trade transaction sent successfully. TXID: ${txid}`);
        return txid;
    } catch (error) {
        console.error('Error in createChannelContractTradeTransaction:', error);
        throw error;
    }
},

async createChannelTokenTradeTransaction(thisAddress, params) {
    try {
        var txNumber = 20;
        var payload = 'tl' + txNumber.toString(36);
        payload += Encode.encodeTradeTokensChannel(params);

        const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
        const rawTx = new litecore.Transaction()
            .from(utxo)
            .addData(payload)
            .change(thisAddress)
            .fee(STANDARD_FEE);

        const privateKey = await this.client.dumpprivkey(thisAddress);
        rawTx.sign(privateKey);

        const serializedTx = rawTx.serialize();
        const txid = await this.client.sendrawtransaction(serializedTx);

        console.log(`Channel Token Trade transaction sent successfully. TXID: ${txid}`);
        return txid;
    } catch (error) {
        console.error('Error in createChannelTokenTradeTransaction:', error);
        throw error;
    }
},

async createTransferTransaction(thisAddress, params) {
    try {
        var txNumber = 22;
        var payload = 'tl' + txNumber.toString(36);
        payload += Encode.encodeTransfer(params);

        const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
        const rawTx = new litecore.Transaction()
            .from(utxo)
            .addData(payload)
            .change(thisAddress)
            .fee(STANDARD_FEE);

        const privateKey = await this.client.dumpprivkey(thisAddress);
        rawTx.sign(privateKey);

        const serializedTx = rawTx.serialize();
        const txid = await this.client.sendrawtransaction(serializedTx);

        console.log(`Transfer transaction sent successfully. TXID: ${txid}`);
        return txid;
    } catch (error) {
        console.error('Error in createTransferTransaction:', error);
        throw error;
    }
},

async createMintTransaction(thisAddress, params) {
    try {
        var txNumber = 24;
        var payload = 'tl' + txNumber.toString(36);
        payload += Encode.encodeMintSynthetic(params);

        const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
        const rawTx = new litecore.Transaction()
            .from(utxo)
            .addData(payload)
            .change(thisAddress)
            .fee(STANDARD_FEE);

        const privateKey = await this.client.dumpprivkey(thisAddress);
        rawTx.sign(privateKey);

        const serializedTx = rawTx.serialize();
        const txid = await client.sendrawtransaction(serializedTx);

        console.log(`Mint transaction sent successfully. TXID: ${txid}`);
        return txid;
    } catch (error) {
        console.error('Error in createMintTransaction:', error);
        throw error;
    }
},

async createRedeemTransaction(thisAddress, params) {
    try {
        var txNumber = 25;
        var payload = 'tl' + txNumber.toString(36);
        payload += Encode.encodeRedeemSynthetic(params);

        const utxo = await this.findSuitableUTXO(thisAddress, STANDARD_FEE);
        const rawTx = new litecore.Transaction()
            .from(utxo)
            .addData(payload)
            .change(thisAddress)
            .fee(STANDARD_FEE);

        const privateKey = await this.client.dumpprivkey(thisAddress);
        rawTx.sign(privateKey);

        const serializedTx = rawTx.serialize();
        const txid = await client.sendrawtransaction(serializedTx);

        console.log(`Redeem transaction sent successfully. TXID: ${txid}`);
        return txid;
    } catch (error) {
        console.error('Error in createRedeemTransaction:', error);
        throw error;
    }
},

createLitecoinMultisigAddress(pubKey1, pubKey2) {
    const publicKeys = [
        new litecore.PublicKey(pubKey1),
        new litecore.PublicKey(pubKey2)
    ];

    const multisig = new litecore.Address(publicKeys, 2); // 2-of-2 multisig
    return multisig.toString();
},

async findSuitableUTXO(address, minAmount) {
    const utxos = await this.client.listUnspent(0, 9999999, [address]);
    const suitableUtxo = utxos.find(utxo => (utxo.amount * COIN >= minAmount) && (utxo.amount * COIN >= DUST_THRESHOLD));
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
},

decodeTransactionType(encodedPayload) {
    const txType = parseInt(encodedPayload.substring(0, 2), 16);
    return txType;
}

};


// Ensure init is called before using any other methods
(async () => {
    await TxUtils.init();
})();

module.exports = TxUtils;