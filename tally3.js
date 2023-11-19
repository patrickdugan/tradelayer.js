const level = require('level');

class TallyMap {
    static instance;

    constructor(path) {
        if (!TallyMap.instance) {
            this.db = level(path);
            this.addresses = new Map();
            TallyMap.instance = this;
        }
        return TallyMap.instance;
    }

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
    }

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

    static getSingletonInstance() {
        if (!TallyMap.instance) {
            throw new Error("TallyMap instance has not been created yet");
        }
        return TallyMap.instance;
    }
}

module.exports = TallyMap;
