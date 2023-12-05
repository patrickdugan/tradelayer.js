const litecoin = require('litecoin');
const {Level} = require('level');
const json = require('big-json');
const util = require('util')
const txUtils = require('./txUtils')

class TxIndex {
    constructor() {
        this.db = new Level('./txIndexDB');
        this.client = new litecoin.Client({
            host: '127.0.0.1',
            port: 18332,
            user: 'user',
            pass: 'pass',
            timeout: 10000
        });
        this.decoderawtransactionAsync = util.promisify(this.client.cmd.bind(this.client,'decoderawtransaction'));
        this.getTransactionAsync = util.promisify(this.client.cmd.bind(this.client, 'gettransaction'))
        this.transparentIndex = []
    }
    
    async initializeIndex(genesisBlock) {
        await this.db.put('genesisBlock', genesisBlock);
    }

    async extractBlockData(startHeight) {
        var chainTip = await this.fetchChainTip();
        for (let height = startHeight; height <= chainTip; height++) {
            var blockData = await this.fetchBlockData(height);
            await this.processBlockData(blockData, height);
            chainTip = await this.fetchChainTip()
        }
        console.log('indexed to chaintip', JSON.stringify(this.transparentIndex))
    }

    async fetchChainTip() {
        return new Promise((resolve, reject) => {
            this.client.getBlockCount((error, chainTip) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(chainTip);
                }
            });
        });
    }

    async fetchBlockData(height) {
        return new Promise((resolve, reject) => {
            this.client.getBlockHash(height, (error, blockHash) => {
                if (error) {
                    reject(error);
                } else {
                    this.client.getBlock(blockHash, (error, block) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(block);
                        }
                    });
                }
            });
        });
    }

     async saveTransactionByHeight(txId, blockHeight) {
        const txKey = `txHeight-${blockHeight}-${txId}`;
        const txData = await this.fetchTransactionData(txId);
        await this.db.put(txKey, JSON.stringify(txData));
    }


    async fetchTransactionData(txId) {
        return new Promise((resolve, reject) => {
            this.client.getRawTransaction(txId, true, (error, transaction) => {
                if (error) {
                    console.log(error)
                    reject(error);
                } else {
                    resolve(transaction.hex);
                }
            });
        });
    }

    async DecodeRawTransaction(rawTx) {
        try {
            const decodedTx = await this.decoderawtransactionAsync(rawTx);
            
            if(rawTx=="02000000000101be64c98a4c17b5861b45b2602873212cb0ada374539c7b61593b2d3e47b8e5cd0100000000ffffffff020000000000000000066a04746c303080b9ff0600000000160014ebecd536259ef21bc6ecc18e45b35412f04722900247304402201ac4b0e373e7555d502e80b5424683dd1da2ca8052793bd2c62d64b2e9370367022014e72b32507262b3c78848b81558acfb2c9f9cb2a8c7968b65615888e7f04d0b012103d6521aea309f7a2768a1cabcb917664966cabc28bc23874b12f73c1989972c5f00000000"){
                console.log('Decoded Transaction:', decodedTx);
            }

            const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata');

            if (opReturnOutput) {
                const opReturnData = opReturnOutput.scriptPubKey.hex;
                //console.log('OP_RETURN Data:', opReturnData);

                // Extract and log the "tl" marker
                const markerHex = opReturnData.substring(4, 8); // '746c' for 'tl'
                const marker = Buffer.from(markerHex, 'hex').toString();
                if(marker=='tl'){console.log('Marker:', marker);}

                // Extract and log the actual payload
                const payloadHex = opReturnData.substring(8);
                const payload = Buffer.from(payloadHex, 'hex').toString();
                if(marker=='tl'){console.log('Decoded Payload:', payload)};


                return { marker, payload , decodedTx};
            } else {
                //console.log('No OP_RETURN output found.');
                return null;
            }
        } catch (error) {
            //console.error('Error decoding raw transaction:', error);
        }
    }

    async processBlockData(blockData, blockHeight) {
         for (var txId of blockData.tx) {
            const txHex = await this.fetchTransactionData(txId);   
            const txData = await this.DecodeRawTransaction(txHex)
            
            if(txData != null){
                if (txData.marker === 'tl') {
                    this.transparentIndex.push(txData.payload)
                    const txDetails = await this.processTransaction(txData.payload, txData.decodedTx);
                    await this.saveTransactionData(txId, txData.decodedTx, txData.payload, blockHeight, txDetails);
                    //console.log(txDetails)
                   
                    // Save each transaction with its block height as a key
                    await this.saveTransactionByHeight(txId, blockHeight);
                }
            }
        }
    }


    async processTransaction(payload, decode) {
        // Example: Extract sender, reference address, payload, etc.
        // These methods can be similar to those in TxUtils
        const sender = await txUtils.getSender(null, decode);
        const reference = await txUtils.getReference(null, decode);
        // Decode the transaction based on its type and payload
        // Extract and process the actual payload
        const decodedParams = Types.decodePayload(txData.txid, 'tl', payload);

        return { sender, reference, payload, decodedParams};
    }

    async saveTransactionData(txId, txData, payload, blockHeight) {
        console.log('saving'+`tx-${blockHeight}-${txId}`, JSON.stringify({ txData, payload}))
        await this.db.put(`tx-${blockHeight}-${txId}`, JSON.stringify({ txData, payload}));
    }

    async loadIndex() {
        return new Promise((resolve, reject) => {
            let data = {};
            this.db.createReadStream()
                .on('data', (entry) => {
                    data[entry.key] = entry.value;
                })
                .on('error', (err) => {
                    console.error('Stream encountered an error:', err);
                    reject(err);
                })
                .on('close', () => {
                    console.log('Stream closed');
                })
                .on('end', () => {
                    console.log('Stream ended');
                    resolve(data);
                });
        });
    }

}

module.exports = TxIndex;
