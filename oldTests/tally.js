class TallyMap {
  constructor() {
    this.addresses = new Map();
    const level = require('level');
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
  }
    return balances;

    totalTokens(propertyId) {
        let total = 0;
        for (const addressObj of this.addresses.values()) {
          // Check if the addressObj has the propertyId
          if (addressObj[propertyId]) {
            total +=
              addressObj[propertyId].available +
              addressObj[propertyId].reserved; // Assuming these are the properties we want to sum
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
}

// Example usage
const tallyMap = new TallyMap('./path_to_db');

tallyMap.updateBalance('address1', 1, 100, 80, 20);
tallyMap.updateBalance('address1', 2, 200, 150, 50);
tallyMap.updateBalance('address2', 1, 50, 40, 10);

console.log('Address 1 Balances:', tallyMap.getAddressBalances('address1'));
console.log('Address 2 Balances:', tallyMap.getAddressBalances('address2'));
