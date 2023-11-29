const { Level } = require('level');

class TallyMap {
    constructor(path) {
        this.db = new Level(path);
        this.addresses = new Map();
    }

    updateBalance(address, propertyId, amount, available, reserved) {
        if (!this.addresses.has(address)) {
            this.addresses.set(address, {});
        }

        const addr = this.addresses.get(address);

        if (!addr[propertyId]) {
            addr[propertyId] = { amount: 0, available: 0, reserved: 0 };
        }

        addr[propertyId].amount += amount;
        addr[propertyId].available += available;
        addr[propertyId].reserved += reserved;
    }

    totalTokens(propertyId) {
        let total = 0;
        for (const a of this.addresses.values()) {
            if (a[propertyId]) {
                total += a[propertyId].available + a[propertyId].reserved;
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

    // Save the tally map to LevelDB
    async save() {
        const serializedMap = JSON.stringify([...this.addresses]);
        await this.db.put('tallyMap', serializedMap);
    }

    // Load the tally map from LevelDB
    async load() {
        const serializedMap = await this.db.get('tallyMap');
        if (serializedMap) {
            this.addresses = new Map(JSON.parse(serializedMap));
        }
    }

    async close() {
        await this.db.close()
    }

    // Get the tally for a specific address and property
    getTally(address, propertyId) {
        const key = `${address}_${propertyId}`;
        return this.addresses.get(key) || 0;
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
