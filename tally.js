const { dbFactory } = require('./db.js')
const { propertyList } = require('./property.js')

class TallyMap {
    // addr => [{p1},{p2}...]
    static Empty = {
        propertyId: 0,
        amount: 0,
        available: 0,
        reserved: 0,
        margin: 0,
        vesting: 0
    }

    constructor(db) {
        this.addresses = new Map()
        this.db = db
    }

    async load() {
        try {
            const entries = await this.db.findAsync({})
            this.addresses = new Map(entries.map(e => [e._id, e?.value]))
            let tl = [...this.addresses.entries()].map(e => `{${this._dump(e[0],e[1])}`)
            console.log(`Loaded tally: ${tl}`)
        } catch (error) {
            console.error('Error loading tally:', error)
        }
    }

    async save(addr, data) {
        try {
            await this.db.updateAsync({ _id: addr }, { $set: { value: data } }, { upsert: true })
            console.log(`Saved tally: ${this._dump(addr,data)}`)
        } catch (error) {
            console.error('Error saving tally: ', error)
        }
    }
    
    _dump(addr, data) {
        return `${addr} => ${JSON.stringify(data)}`
    }

    async updateBalance(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, tradeSettlement) {
        if (tradeSettlement == true) {
            console.log(`Trade Settlement: pid:${propertyId}, achange:${availableChange}, rchange:${reservedChange}, mchange:${marginChange}`)
        }

        // if (availableChange == null || reservedChange == null || marginChange == null || vestingChange == null || isNaN(availableChange) || isNaN(reservedChange) || isNaN(marginChange) || isNaN(vestingChange)) {
        //     throw new Error('Somehow null passed into updateBalance... avail. ' + availableChange + ' reserved ' + reservedChange + ' margin' + marginChange + ' vesting ' + vestingChange)
        // }

        if (!Number.isInteger(propertyId)) {
            throw new Error(`Invalid propertyId: ${propertyId}`)
        }

        let data = this.addresses.get(address)
        if (!Array.isArray(data)) {
            data = []
            this.addresses.set(address, data)
        }

        let p = { ...TallyMap.Empty }
        let i = data.findIndex(d => d?.propertyId == propertyId)
        if (i < 0) {
            p.propertyId = propertyId
            data.push(p)
        } else {
            p = data[i]
        }

        // Check and update available balance
        if (p.available + availableChange < 0) {
            throw new Error("Available balance cannot go negative " + p.available + ' change ' + availableChange)
        }
        p.available += availableChange;

        // Check and update reserved balance
        if (p.reserved + reservedChange < 0) {
            console.log('propertyId, reserved, reservedChange ' + JSON.stringify(p) + ' ' + p.reserved + ' ' + reservedChange)
            throw new Error("Reserved balance cannot go negative " + propertyId + ' ' + availableChange + ' ' + reservedChange)
        }
        p.reserved += reservedChange;

        // Check and update margin balance
        if (p.margin + marginChange < 0) {
            throw new Error("Margin balance cannot go negative")
        }
        p.margin += marginChange;

        // Check and update vesting balance
        if (p.vesting + vestingChange < 0) {
            throw new Error("Vesting balance cannot go negative")
        }
        p.vesting += vestingChange;
        p.amount = p.available + p.reserved + p.margin + p.vesting

        await this.save(address, data)

        console.log('Tally has been changed: ' + JSON.stringify(data) + ' for addr: ' + address)
    }

    async checkInitializationFlag() {
        return propertyList.getProperty(1)?.ticker === 'TL'
    }

    /**
     * Checks if a sender has a sufficient balance of a specific property.
     * @param {string} senderAddress - The address of the sender.
     * @param {number} propertyId - The ID of the property to check.
     * @param {number} requiredAmount - The amount required for the transaction.
     * @returns {Promise<{hasSufficient: boolean, reason: string}>} - An object indicating if the balance is sufficient and a reason if it's not.
     */
    async hasSufficientBalance(senderAddress, propertyId, requiredAmount) {
        try {
            const senderTally = await this.getTally(senderAddress, propertyId)
            console.log('Checking senderTally', senderAddress, propertyId, JSON.stringify(senderTally))

            if (!senderTally?.available) {
                return { hasSufficient: false, reason: 'Error loading tally or tally not found' };
            }

            console.log('Available tokens:', senderTally.available, 'Required amount:', requiredAmount)

            if (senderTally.available < requiredAmount) {
                return { hasSufficient: false, reason: 'Insufficient available balance' };
            }

            return { hasSufficient: true, reason: '' };
        } catch (error) {
            console.error('Error in hasSufficientBalance:', error)
            return { hasSufficient: false, reason: 'Unexpected error checking balance' };
        }
    }

    totalTokens(propertyId) {
        let total = 0;
        for (const v of this.addresses.values()) {
            const i = Array.isArray(v) & v.findIndex(d => d?.propertyId == propertyId)
            const p = v[i]
            if (Number.isInteger(p?.available)) {
                total += p.available + p.reserved;
            }
        }
        return total;
    }

    // Get the tally for a specific address and property
    async getTally(address, propertyId) {
        if (this.addresses.has(address)) {
            const data = this.addresses.get(address)
            const i = Array.isArray(data) & data.findIndex(d => d?.propertyId == propertyId)
            const p = data[i]
            if (Number.isInteger(p?.available)) {
                return {
                    amount: p.amount,
                    available: p.available,
                    reserved: p.reserved,
                    margin: p.margin,
                    vesting: p.vesting
                }
            }
        }

        console.log(`can't find property for address: addr:${address}; pid:${propertyId}`)

        return TallyMap.Empty
    }

    getAddressBalances(address) {
        const bal = []
        if (this.addresses.has(address)) {
            const properties = this.addresses.get(address)
            for (const p of properties) {
                bal.push({
                    propertyId: p.propertyId,
                    amount: p.amount,
                    available: p.available,
                    reserved: p.reserved,
                    vesting: p.vesting
                })
            }
        }
        return bal
    }

    /**
     * Retrieves all addresses that have a balance for a given property.
     * @param {number} propertyId - The property ID to check balances for.
     * @return {Array} - An array of addresses that have a balance for the specified property.
     */
    getAddressesWithBalanceForProperty(propertyId) {
        const data = [];
        for (const [k, v] of this.addresses.entries()) {
            const i = Array.isArray(v) & v.findIndex(d => d?.propertyId == propertyId)
            const p = v[i]
            if (p?.amount > 0 || p?.reserved > 0) {
                data.push({
                    address: k,
                    amount: p.amount,
                    reserved: p.reserved
                })
            }
        }
        return data;
    }

    // TODO: fixme
    // async applyDeltasSinceLastHeight(lastHeight) {
    //     // Retrieve and apply all deltas from lastHeight to the current height
    //     for (let height = lastHeight + 1; height <= currentBlockHeight; height++) {
    //         const serializedDelta = await this.db.findOneAsync(`{ _id: 'tallyMapDelta-${height}' }`)
    //         if (serializedDelta) {
    //             const delta = JSON.parse(serializedDelta)
    //             this.applyDelta(delta)
    //         }
    //     }
    // }

    // Function to record a delta
    // recordTallyMapDelta(blockHeight, txId, address, propertyId, amountChange) {
    //     const deltaKey = `tallyMapDelta-${blockHeight}-${txId}`;
    //     const delta = { address, propertyId, amountChange };
    //     return this.db.insert(deltaKey, JSON.stringify(delta))
    // }

    // Function to apply a delta to the TallyMap
    // async applyDeltaToTallyMap(delta) {
    //     const { address, propertyId, amountChange } = delta;
    //     // Logic to apply the change to TallyMap
    //     await this.updateBalance(address, propertyId, amountChange)
    // }

    // async saveTallyDelta(blockHeight, delta) {
    //     const serializedDelta = JSON.stringify(delta)
    //     this.db.insert(`tallyMapDelta-${blockHeight}`, serializedDelta)
    // }

    // Function to save the aggregated block delta
    // saveBlockDelta(blockHeight, blockDelta) {
    //     const deltaKey = `blockDelta-${blockHeight}`;
    //     this.db.insert(deltaKey, JSON.stringify(blockDelta))
    // }

    // Function to load all deltas for a block
    // async loadDeltasForBlock(blockHeight) {
    //     // Load and parse all deltas from the database for the given block height
    // }
}

let tally
(async () => {
    tally = new TallyMap(dbFactory.getDatabase('tallyMap'))
    await tally.load()
})()

exports.tallyMap = tally
