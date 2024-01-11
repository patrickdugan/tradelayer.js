const TxUtils = require('./txUtils.js')
const Types = require('./types.js')
const {dbFactory} = require('./db.js')

//const e = require('express')

// const clientConfig = /*test ?*/ {
//     host: '127.0.0.1',
//     port: 18332,
//     user: 'user',
//     pass: 'pass',
//     timeout: 10000
// }

// const client = new litecoin.Client(clientConfig)

// const getTransactionAsync = util.promisify(client.cmd.bind(client, 'gettransaction'))
// const getBlockCountAsync = util.promisify(client.cmd.bind(client, 'getblockcount'))
// const transparentIndex = [];

class TxIndex {

    constructor(db) {
        this.db = db
    }

    async ensureGenesisBlock(genesisBlock) {
        try {
            const block = await this.db.getDatabase('txIndex').findOneAsync({ _id: 'genesisBlock' })
            if (block?.value) {
                console.log('Genesis block is already initialized:', block.value)
            } else {
                await this.db.getDatabase('txIndex').insertAsync({ _id: 'genesisBlock', value: genesisBlock })
                console.log('Genesis block initialized:', genesisBlock)
            }
        } catch (error) {
            // Handle any errors that occur during database access
            console.error('Error accessing genesis block:', error)
            throw error
        }
    }

    async extractBlockData(startHeight) {
        let chainTip = await this.fetchChainTip()
        console.log('building index until' + chainTip)
        for (let height = startHeight; height <= chainTip; height++) {
            if (height % 1000 == 1) { console.log('indexed to ' + height) }
            let blockData = await this.fetchBlockData(height)
            //console.log(blockData)
            await this.processBlockData(blockData, height)
            //chainTip = await this.fetchChainTip()
        }
        console.log('indexed to chaintip')

        // Use the correct NeDB method to insert or update the 'indexExists' document
        // After processing the block, update 'MaxHeight'
        let txdb = this.db.getDatabase('txIndex')
        try {
            await txdb.updateAsync(
                { _id: 'MaxHeight' },
                { _id: 'MaxHeight', value: chainTip },
                { upsert: true }
            )
        } catch (error) {
            console.error('Error updating MaxHeight:', error)
            throw error
        }

        try {
            await txdb.updateAsync(
                { _id: 'indexExists' },
                { _id: 'indexExists', value: true },
                { upsert: true } // This option ensures that the document is inserted if it doesn't exist or updated if it does.
            )
            console.log('Index flag set successfully.')
        } catch (error) {
            console.error('Error setting the index flag:', error)
            throw error
        }

        console.log('built index')
    }


    static async fetchChainTip() {
        return await TxUtils.getBlockCountAsync()
    }

    static async fetchBlockData(height) {
        return await TxUtils.getBlockAsync(height)
    }

    static async fetchTransactionData(txId) {
        return await TxUtils.getRawTransaction(txId)
    }

    async processBlockData(blockData, blockHeight) {
        const txdb = this.db.getDatabase('txIndex')
        for (const txId of blockData.tx) {
            const txHex = await this.fetchTransactionData(txId)
            const txData = await this.decodeRawTransaction(txHex)
            if (txData != null && txData != undefined && txData.marker === 'tl') {
                const payload = txData.payload
                const txDetails = await this.processTransaction(payload, txId, txData.marker)
                console.log('payload ' + payload + JSON.stringify(txDetails))
                try {
                    await txdb.insertAsync({ _id: `tx-${blockHeight}-${txId}`, value: txDetails })
                } catch (dbError) {
                    console.error(`Error inserting transaction data for txId ${txId} at blockHeight ${blockHeight}:`, dbError)
                }
            }
        }
    }

    async decodeRawTransaction(rawTx) {
        try {
            const decodedTx = await TxUtils.decoderawtransaction(rawTx)
            const opReturnOutput = decodedTx.vout.find(output => output.scriptPubKey.type === 'nulldata')
            if (opReturnOutput) {
                const opReturnData = opReturnOutput.scriptPubKey.hex
                //console.log('OP_RETURN Data:', opReturnData)
                // Extract and log the "tl" marker
                let markerHex = opReturnData.substring(4, 8) // '746c' for 'tl'
                let marker = Buffer.from(markerHex, 'hex').toString()
                let payloadStart = 8

                if (marker == ']t') {
                    console.log('Entering weird OP_Return pacing block')
                    console.log('Current marker:', marker)
                    try {
                        console.log('weird OP_Return pacing', opReturnData.substring(6, 10))
                        markerHex = opReturnData.substring(6, 10)
                        marker = Buffer.from(markerHex, 'hex').toString()
                        payloadStart = 10
                        console.log('fixed?', marker)
                    } catch (error) {
                        console.error('Error in processing:', error)
                    }
                }
                // Extract and log the actual payload
                const payloadHex = opReturnData.substring(payloadStart)
                const payload = Buffer.from(payloadHex, 'hex').toString()
                if (marker == 'tl') { console.log('Pre-decoded and Decoded Payload:', opReturnData + ' ' + payload + ' decoding the whole thing ' + Buffer.from(opReturnData, 'hex').toString()) }
                return { marker, payload, decodedTx }
            } else {
                //console.log('No OP_RETURN output found.')
                return null
            }
            // Process decoded transaction logic here...
            return decodedTx
        } catch (error) {
            //console.error('Error decoding raw transaction:', error)
        }
    }

    async processTransaction(payload, txId, marker) {
        const sender = await TxUtils.getSender(txId)
        const reference = await TxUtils.getReference(txId)
        const decodedParams = Types.decodePayload(txId, marker, payload)
        return { sender, reference, payload, decodedParams, marker }
    }

    async saveTransactionData(txId, txData, payload, blockHeight, txDetails) {
        const indexKey = `tx-${blockHeight}-${txId}`
        const document = {
            _id: indexKey,
            txData: txDetails
        }

        console.log(document)

        try {
            // Check if the document already exists
            let txdb = this.getDatabase('txIndex')
            const existingDocument = await txdb.findOneAsync({ _id: indexKey })

            if (existingDocument) {
                // Document exists, perform an update
                const update = { $set: { txData, payload } }
                await txdb.updateAsync({ _id: indexKey }, update)
                //console.log(`Transaction data updated for ${indexKey}`)
            } else {
                // Document does not exist, perform an insert
                await txdb.insertAsync(document)
                //console.log(`Transaction data inserted for ${indexKey}`)
            }
        } catch (error) {
            // Handle any errors
            console.error(`Error saving transaction data for ${indexKey}: ${error}`)
        }
    }

    async getIndexData() {
        try {
            const txdb = this.db.getDatabase('txIndex')
            let data = {}
            const entries = await txdb.findAsync({})
            entries.forEach(e => {
                data[e._id] = e.value
            })
            return entries
        } catch (error) {
            console.error('Error loading index:', error)
        }
    }

    async upsertTxValidityAndReason(txId, type, blockHeight, isValid, reason) {
        const indexKey = `tx-${blockHeight}-${txId}`

        try {
            // Assuming the database instance is accessible as `db`
            await this.db.getDatabase('txIndex').updateAsync(
                { _id: indexKey },
                { $set: { type: type, valid: isValid, reason: reason } },
                { upsert: true }
            )
            //console.log(`Transaction ${indexKey} validity updated in txIndex.`)
        } catch (error) {
            console.error(`Error updating transaction ${indexKey} in txIndex:`, error)
        }
    }

    async clear() {
        await this.db.getDatabase('txIndex').remove({}, { multi: true })
        console.log('Cleared all entries from txIndex DB.')
    }

    async resetIndexFlag() {
        await this.db.getDatabase('txIndex').del('indexExists')
        await this.db.getDatabase('txIndex').del('genesisBlock')
        console.log('Index flags reset successfully.')
    }

    async findMaxIndexedBlock() {
        try {
            const txdb = this.db.getDatabase('txIndex')
            const mh = await txdb.findOneAsync({ _id: 'MaxHeight' })

            if (mh) {
                return mh.value
            } else {
                // Handle the case where MaxHeight hasn't been set yet
                //console.log('MaxHeight not found in txIndexDB.')
                return 3082500 // or an appropriate default/fallback value
            }
        } catch (err) {
            console.error('Error finding MaxIndexedBlock:', err)
            throw err
        }
    }

    /**
     * Retrieves and deserializes data for a given transaction ID from the txIndex database.
     * @param {string} txId The transaction ID to query.
     * @returns {Promise<object|null>} The deserialized transaction data or null if not found.
     */
    async getTransactionData(txId) {
        try {
            const txdb = this.db.getDatabase('txIndex')
            //const blockHeight = this.fetchChainTip()
            const txData = await txdb.findOneAsync({ _id: txId })

            if (txData) {
                console.log(`Transaction data found for ${txId}:`, txData)
                return txData.value // Return the value part of the transaction data
            } else {
                console.log(`No transaction data found for ${txId}.`)
                return null
            }
        } catch (error) {
            console.error(`Error retrieving transaction data for ${txId}:`, error)
            throw error
        }
    }

    async checkForIndex() {
        try {
            const txdb = this.db.getDatabase('txIndex')
            const exists = await txdb.findOneAsync({ _id: 'indexExists' })

            if (exists) {
                console.log(`'indexExists' key found with value: ${exists.value}`)
                return true // The index exists
            } else {
                console.log("'indexExists' key not found.")
                return false // The index does not exist
            }
        } catch (error) {
            console.error('Error checking for index:', error)
            throw error
        }
    }
}

exports.txIndex = new TxIndex(dbFactory)
