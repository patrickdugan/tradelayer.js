var db = require('./db')

class TallyMap {
    static instance;

    constructor(path) {
        if (!TallyMap.instance) {
            this.addresses = new Map();
            TallyMap.instance = this;
        }
        return TallyMap.instance;
    },

    updateBalance(address, propertyId, amount, available, reserved) {
        if (!this.addresses.has(address)) {
            this.addresses.set(address, {});
        }
        const addressObj = this.addresses.get(address);

        if (!addressObj[propertyId]) {
            addressObj[propertyId] = { amount: 0, available: 0, reserved: 0 };
        }

        addressObj[propertyId].amount += amount;
        addressObj[propertyId].available += available;
        addressObj[propertyId].reserved += reserved;
    },

    getAddressBalances(address) {
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
    },

    totalTokens(propertyId) {
        let total = 0;
        for (const addressObj of this.addresses.values()) {
            if (addressObj[propertyId]) {
                total += addressObj[propertyId].available + addressObj[propertyId].reserved;
            }
        }
        return total;
    },

    async save(blockHeight) {
        const serializedData = JSON.stringify([...this.addresses]);
        await this.db.put(`block-${blockHeight}`, serializedData);
    },

    async load(blockHeight) {
        try {
            const serializedData = await this.db.get(`block-${blockHeight}`);
            const addressesArray = JSON.parse(serializedData);
            this.addresses = new Map(addressesArray);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    },

    static getSingletonInstance() {
        if (!TallyMap.instance) {
            throw new Error("TallyMap instance has not been created yet");
        }
        return TallyMap.instance;
    },

    // Get the tally for a specific address and property
    getTally(address, propertyId) {
        const key = `${address}_${propertyId}`;
        return this.tallyMap.get(key) || 0;
    },

    // Save the tally map to LevelDB
    async saveTallyMap() {
        const serializedMap = JSON.stringify(Array.from(this.tallyMap.entries()));
        await this.dbInterface.storeData('tallyMap', serializedMap);
    },

    // Load the tally map from LevelDB
    async loadTallyMap() {
        const serializedMap = await this.dbInterface.getData('tallyMap');
        if (serializedMap) {
            this.tallyMap = new Map(JSON.parse(serializedMap));
        }
    },

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
    },

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
