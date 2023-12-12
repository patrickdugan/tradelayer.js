var db = require('./db')
var TxIndex = require('./txindex.js')

class TallyMap {
    static instance;

    constructor(path) {
        if (!TallyMap.instance) {
            this.addresses = new Map();
            TallyMap.instance = this;
        }
        return TallyMap.instance;
    }


    /**
     * Ensures that only one instance of TallyMap exists and attempts to load it from DB.
     * @param {number} blockHeight - The block height for which to load the tally map.
     * @returns {Promise<TallyMap>} - A promise that resolves to the singleton instance of the TallyMap.
     */
    static async getInstance(blockHeight) {
        if (!TallyMap.instance) {
            TallyMap.instance = new TallyMap();
        }
        await TallyMap.instance.loadFromDB(blockHeight);
        return TallyMap.instance;
    }

    
    static async updateBalance(address, propertyId, amountChange, availableChange, reservedChange) {
            const instance = await this.getInstance();
            if (!instance.addresses.has(address)) {
                instance.addresses.set(address, {});
            }
            const addressObj = instance.addresses.get(address);

            if (!addressObj[propertyId]) {
                addressObj[propertyId] = { amount: 0, available: 0, reserved: 0 };
            }

            const newAmount = addressObj[propertyId].amount + amountChange;
            const newAvailable = addressObj[propertyId].available + availableChange;
            const newReserved = addressObj[propertyId].reserved + reservedChange;

            if (newAmount < 0 || newAvailable < 0 || newReserved < 0) {
                throw new Error("Balance cannot go negative");
            }

            addressObj[propertyId].amount = newAmount;
            addressObj[propertyId].available = newAvailable;
            addressObj[propertyId].reserved = newReserved;

            console.log('new amount '+newAmount+ 'newAvailable '+newAvailable + 'newReserved'+ newReserved)
            const blockHeight = TxIndex.fetchChainTip()

            await instance.saveDeltaToDB({'address':address,'newAmount':newAmount,'newAvailable':newAvailable,'newReserved':newReserved})
    }


    static getAddressBalances(address) {
        if (!this.addresses.has(address)) {
            return [];
        }

        const addressObj = this.addresses.get(address);
        const balances = [];

        for (const propertyId in addressObj) {
            if (Object.hasOwnProperty.call(addressObj, propertyId)) {
                const balanceObj = addressObj[propertyId];
                balances.push({
                    propertyId: propertyId,
                    amount: balanceObj.amount,
                    available: balanceObj.available,
                    reserved: balanceObj.reserved,
                });
            }
        }
        return balances;
    }

    async saveToDB(blockHeight) {
        const serializedData = JSON.stringify([...this.addresses]);
        await db.put(`tallyMap`, serializedData);
    }

    async loadFromDB(blockHeight) {
        try {
            const query = { _id: `tallyMap` };
            const result = await db.getDatabase('tallyMap').findOneAsync(query);

            if (result && result.value) {
                this.addresses = new Map(JSON.parse(result.value));
            }
        } catch (error) {
            console.error('Error loading tally map from DB:', error);
        }
    }


    async applyDeltasSinceLastHeight(lastHeight) {
        // Retrieve and apply all deltas from lastHeight to the current height
        for (let height = lastHeight + 1; height <= currentBlockHeight; height++) {
            const serializedDelta = await db.get(`tallyMapDelta-${height}`);
            if (serializedDelta) {
                const delta = JSON.parse(serializedDelta);
                this.applyDelta(delta);
            }
        }
    }

    // Function to record a delta
    async recordTallyMapDelta(blockHeight, txId, address, propertyId, amountChange) {
        const deltaKey = `tallyMapDelta-${blockHeight}-${txId}`;
        const delta = { address, propertyId, amountChange };
        return await db.getDatabase('tallyMap').insert(deltaKey, JSON.stringify(delta));
    }

// Function to apply a delta to the TallyMap
    applyDeltaToTallyMap(delta) {
        const { address, propertyId, amountChange } = delta;
        // Logic to apply the change to TallyMap
        TallyMap.updateBalance(address, propertyId, amountChange);
    }

    async saveDeltaToDB(blockHeight, delta) {
        const serializedDelta = JSON.stringify(delta);
        await db.getDatabase('tallyMap').insert(`tallyMapDelta-${blockHeight}`, serializedDelta);
    }

    // Function to save the aggregated block delta
    saveBlockDelta(blockHeight, blockDelta) {
        const deltaKey = `blockDelta-${blockHeight}`;
        db.getDatabase('tallyMap').insert(deltaKey, JSON.stringify(blockDelta));
    }

    // Function to load all deltas for a block
    async loadDeltasForBlock(blockHeight) {
        // Load and parse all deltas from the database for the given block height
    }

    static totalTokens(propertyId) {
        let total = 0;
        for (const addressObj of this.addresses.values()) {
            if (addressObj[propertyId]) {
                total += addressObj[propertyId].available + addressObj[propertyId].reserved;
            }
        }
        return total;
    }

    async save(blockHeight) {
        const serializedData = JSON.stringify([...this.addresses]);
        await this.db.put(`block-${blockHeight}`, serializedData);
    }

    async load(blockHeight) {
        try {
            const serializedData = await this.db.get(`block-${blockHeight}`);
            const addressesArray = JSON.parse(serializedData);
            this.addresses = new Map(addressesArray);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    // Get the tally for a specific address and property
    static getTally(address, propertyId) {
        if (!this.addresses.has(address)) {
            return 0;
        }
        const addressObj = this.addresses.get(address);
        if (!addressObj[propertyId]) {
            return 0;
        }
        return addressObj[propertyId].amount; // or other specific fields like available, reserved
    }

    // Save the tally map to LevelDB
    async saveTallyMap() {
        const serializedMap = JSON.stringify(Array.from(this.tallyMap.entries()));
        await this.dbInterface.storeData('tallyMap', serializedMap);
    }

    // Load the tally map from LevelDB
    async loadTallyMap() {
        const serializedMap = await this.dbInterface.getData('tallyMap');
        if (serializedMap) {
            this.tallyMap = new Map(JSON.parse(serializedMap));
        }
    }

    getAddressBalances(address) {
        const balances = [];
        if (this.addresses.has(address)) {
            const properties = this.addresses.get(address);
            for (const [propertyId, balanceData] of Object.entries(properties)) {
                balances.push({
                    propertyId: propertyId,
                    balance: balanceData
                });
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
                        });
                    }
                }
            }

            return addressesWithBalances;
    }
}

module.exports = TallyMap;
