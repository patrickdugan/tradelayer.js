const { dbFactory } = require('./db.js')
const { propertyList } = require('./property.js')

class TallyMap {

    constructor(dbTally, dbFee) {
        this.addresses = new Map()
        this.feeCache = new Map()
        this.dbTally = dbTally;
        this.dbFee = dbFee;
    }

    async verifyPropertyIds() {
        const data = await propertyList.getProperties()

        for (const [address, properties] of this.addresses.entries()) {
            for (const propertyId in properties) {
                if (!data.has(propertyId)) {
                    console.error(`Invalid propertyId ${propertyId} found for address ${address}`)
                    // TODO: Handle the error - either remove the invalid entry or log it for further investigation
                }
            }
        }
    }

    async updateBalance(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, tradeSettlement, contractSettlement, contractClearing, txid) {
        if (tradeSettlement == true) {
            console.log('Trade Settlement: txid, property id, available change, reserved change ' + txid + propertyId, availableChange, reservedChange, marginChange)
        }
        if (availableChange == null || reservedChange == null || marginChange == null || vestingChange == null || isNaN(availableChange) || isNaN(reservedChange) || isNaN(marginChange) || isNaN(vestingChange)) {
            throw new Error('Somehow null passed into updateBalance... avail. ' + availableChange + ' reserved ' + reservedChange + ' margin' + marginChange + ' vesting ' + vestingChange)
        }

        if (!Number.isInteger(propertyId)) {
            return Error(`Invalid propertyId: ${propertyId}`)
        }

        if (!this.addresses.has(address)) {
            this.addresses.set(address, {})
        }

        const addressObj = this.addresses.get(address)
        console.log('addressObj being changed ' + JSON.stringify(addressObj) + ' for addr ' + address)
        if (!addressObj[propertyId]) {
            addressObj[propertyId] = { amount: 0, available: 0, reserved: 0, margin: 0, vesting: 0 };
        }

        // Check and update available balance
        if (addressObj[propertyId].available + availableChange < 0) {
            throw new Error("Available balance cannot go negative " + addressObj[propertyId].available + ' change ' + availableChange)
        }
        addressObj[propertyId].available += availableChange;

        // Check and update reserved balance
        if (addressObj[propertyId].reserved + reservedChange < 0) {
            console.log('propertyId, reserved, reservedChange ' + JSON.stringify(addressObj[propertyId]) + ' ' + addressObj[propertyId].reserved + ' ' + reservedChange)
            throw new Error("Reserved balance cannot go negative " + propertyId + ' ' + availableChange + ' ' + reservedChange)
        }
        addressObj[propertyId].reserved += reservedChange;

        // Check and update margin balance
        if (addressObj[propertyId].margin + marginChange < 0) {
            throw new Error("Margin balance cannot go negative")
        }
        addressObj[propertyId].margin += marginChange;

        // Check and update vesting balance
        if (addressObj[propertyId].vesting + vestingChange < 0) {
            throw new Error("Vesting balance cannot go negative")
        }
        addressObj[propertyId].vesting += vestingChange;

        // Update the total amount
        addressObj[propertyId].amount = this.constructor.calculateTotal(addressObj[propertyId])

        this.addresses.set(address, addressObj) // Update the map with the modified address object
        console.log('Updated balance for address:', JSON.stringify(addressObj), 'with propertyId:', propertyId)
        await this.saveTally() // Save changes to the database
    }


    static calculateTotal(balanceObj) {
        return balanceObj.available + balanceObj.reserved + balanceObj.margin + balanceObj.vesting;
    }

    static roundToEightDecimals(number) {
        return Math.floor(number * 1e8) / 1e8;
    }


    async setInitializationFlag() {
        await this.dbTally.updateAsync(
            { _id: '$TLinit' },
            { _id: '$TLinit', initialized: true },
            { upsert: true }
        )
    }

    async checkInitializationFlag() {
        const result = await this.dbTally.findOneAsync({ _id: '$TLinit' })
        return result ? result.initialized : false;
    }


    getAddressBalances(address) {
        // Check if the address exists in the map
        if (!this.addresses.has(address)) {
            console.log(`No data found for address: ${address}`)
            return [];
        }

        const addressObj = this.addresses.get(address)
        //console.log(`Data for address ${address}:`, addressObj)
        const balances = [];
        for (const propertyId in addressObj) {
            if (Object.hasOwnProperty.call(addressObj, propertyId)) {
                const balanceObj = addressObj[propertyId];
                balances.push({
                    propertyId: propertyId,
                    amount: balanceObj.amount,
                    available: balanceObj.available,
                    reserved: balanceObj.reserved,
                    vesting: balanceObj.vesting
                })
            }
        }
        //console.log(`Balances for address ${address}:`, balances)
        return balances;
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

            if (!senderTally || senderTally.available === undefined) {
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

    async saveTally() {
        try {
            const serializedData = JSON.stringify([...this.addresses])
            await this.dbTally.updateAsync({ _id: 'tallyMap' }, { $set: { data: serializedData } }, { upsert: true })
            console.log('TallyMap saved successfully.')
        } catch (error) {
            console.error('Error saving TallyMap:', error)
        }
    }

    async loadTally() {
        try {
            const result = await this.dbTally.findOneAsync({ _id: 'tallyMap' })
            if (result && result.data) {
                const mapDataArray = JSON.parse(result.data)
                this.addresses = new Map(mapDataArray.map(([key, value]) => [key, value]))
            } else {
                //console.log('failed to load tallyMap, starting a new map')
                this.addresses = new Map() // Ensure addresses is always a Map
            }
        } catch (error) {
            console.error('Error loading tally map from dbInstance:', error)
        }
    }

    async saveFees() {
        try {
            for (let [propertyId, feeAmount] of this.feeCache.entries()) {
                const serializedFeeAmount = JSON.stringify(feeAmount)
                await this.dbFee.updateAsync(
                    { _id: 'feeCache-' + propertyId },
                    { _id: 'feeCache-' + propertyId, value: serializedFeeAmount },
                    { upsert: true }
                )
            }
            console.log('FeeCache saved successfully.')
        } catch (error) {
            console.error('Error saving FeeCache:', error)
        }
    }

    async loadFees() {
        try {
            this.feeCache = new Map()
            let keys = await propertyList.getProperties().map(p => p.id)
            // Assuming you have a list of property IDs, iterate through them
            for (const k of keys) {
                const result = await this.dbFee.findOneAsync(`{ _id: 'feeCache-${k}' }`)
                if (result && result.value) {
                    const feeAmount = JSON.parse(result.value)
                    this.feeCache.set(k, feeAmount)
                }
            }
            console.log('FeeCache loaded successfully.')
        } catch (error) {
            console.error('Error loading fee cache:', error)
        }
    }

    async applyDeltasSinceLastHeight(lastHeight) {
        // Retrieve and apply all deltas from lastHeight to the current height
        for (let height = lastHeight + 1; height <= currentBlockHeight; height++) {
            const serializedDelta = await this.dbTally.findOneAsync(`{ _id: 'tallyMapDelta-${height}' }`)
            if (serializedDelta) {
                const delta = JSON.parse(serializedDelta)
                this.applyDelta(delta)
            }
        }
    }

    // Method to update fee cache for a property
    async updateFees(propertyId, feeAmount) {
        await this.loadFees()

        if (!this.feeCache.has(propertyId)) {
            this.feeCache.set(propertyId, 0) // Initialize if not present
        }
        const currentFee = this.feeCache.get(propertyId)
        this.feeCache.set(propertyId, currentFee + feeAmount)

        // Optionally, persist fee cache changes to database if necessary
        await this.saveFees()
    }

    async drawOnFees(propertyId) {
        await this.loadFees()

        if (!this.feeCache.has(propertyId)) {
            console.log(`No fee cache available for property ID ${propertyId}`)
            return;
        }

        const feeAmount = this.feeCache.get(propertyId)
        if (feeAmount <= 0) {
            console.log(`Insufficient fee cache for property ID ${propertyId}`)
            return;
        }

        // Logic to match with standing sell orders of property ID 1
        // Adjust this logic based on how you handle order matching
        // ...

        // Deduct the matched amount from the fee cache
        this.feeCache.set(propertyId, this.feeCache.get(propertyId) - matchedAmount)

        // Insert the purchased property ID 1 units into the insurance fund
        // Adjust this logic to match your insurance fund implementation
        // ...

        // Save the updated fee cache to the database
        await this.saveFees()
    }

    // Function to record a delta
    recordTallyMapDelta(blockHeight, txId, address, propertyId, amountChange) {
        const deltaKey = `tallyMapDelta-${blockHeight}-${txId}`;
        const delta = { address, propertyId, amountChange };
        return this.dbTally.insert(deltaKey, JSON.stringify(delta))
    }

    // Function to apply a delta to the TallyMap
    async applyDeltaToTallyMap(delta) {
        const { address, propertyId, amountChange } = delta;
        // Logic to apply the change to TallyMap
        await this.updateBalance(address, propertyId, amountChange)
    }

    async saveTallyDelta(blockHeight, delta) {
        const serializedDelta = JSON.stringify(delta)
        this.dbTally.insert(`tallyMapDelta-${blockHeight}`, serializedDelta)
    }

    // Function to save the aggregated block delta
    saveBlockDelta(blockHeight, blockDelta) {
        const deltaKey = `blockDelta-${blockHeight}`;
        this.dbTally.insert(deltaKey, JSON.stringify(blockDelta))
    }

    // Function to load all deltas for a block
    async loadDeltasForBlock(blockHeight) {
        // Load and parse all deltas from the database for the given block height
    }

    totalTokens(propertyId) {
        let total = 0;
        for (const addressObj of this.addresses.values()) {
            if (addressObj[propertyId]) {
                total += addressObj[propertyId].available + addressObj[propertyId].reserved;
            }
        }
        return total;
    }

    // Get the tally for a specific address and property
    async getTally(address, propertyId) {
        const obj = this.addresses.get(address)
        console.log(JSON.stringify(this.addresses))
         if (obj && obj[propertyId] !== undefined) {
            console.log("can't find property in address")
            return 0;
        }
        return {
            amount: obj[propertyId].amount,
            available: obj[propertyId].available,
            reserved: obj[propertyId].reserved,
            margined: obj[propertyId].margined,
            vesting: obj[propertyId].vesting
        }; // or other specific fields like available, reserved
    }

    getAddressBalances(address) {
        console.log('ze tally map' + this.addresses)
        const balances = [];
        if (this.addresses.has(address)) {
            const properties = this.addresses.get(address)
            for (const [propertyId, balanceData] of Object.entries(properties)) {
                balances.push({
                    propertyId: propertyId,
                    balance: balanceData
                })
            }
        }
        return balances;
    }

    /**
     * Retrieves all addresses that have a balance for a given property.
     * @param {number} propertyId - The property ID to check balances for.
     * @return {Array} - An array of addresses that have a balance for the specified property.
     */
    getAddressesWithBalanceForProperty(propertyId) {
        const addressesWithBalances = [];

        for (const [address, balances] of this.addresses.entries()) {
            if (balances[propertyId]) {
                const balanceInfo = balances[propertyId];
                if (balanceInfo.amount > 0 || balanceInfo.reserved > 0) {
                    addressesWithBalances.push({
                        address: address,
                        amount: balanceInfo.amount,
                        reserved: balanceInfo.reserved
                    })
                }
            }
        }

        return addressesWithBalances;
    }
}

let tally
(async () => {
    tally = new TallyMap(dbFactory.getDatabase('tallyMap'), dbFactory.getDatabase('feeCache'))
    await tally.loadTally()
})()

exports.tallyMap = tally
