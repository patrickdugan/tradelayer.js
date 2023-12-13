var dbInstance = require('./db.js')
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
     * Ensures that only one instance of TallyMap exists and attempts to load it from dbInstance.
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

    
    static async updateBalance(address, propertyId, amountChange, availableChange, reservedChange,vestingChange) {
            const instance = await this.getInstance();
            if (!instance.addresses.has(address)) {
                instance.addresses.set(address, {});
            }
            const addressObj = instance.addresses.get(address);

            if (!addressObj[propertyId]) {
                addressObj[propertyId] = { amount: 0, available: 0, reserved: 0, vesting: 0 };
            }

            const newAmount = addressObj[propertyId].amount + amountChange;
            const newAvailable = addressObj[propertyId].available + availableChange;
            const newReserved = addressObj[propertyId].reserved + reservedChange;
            const newVesting = addressObj[propertyId].vesting+vestingChange

            if (newAmount < 0 || newAvailable < 0 || newReserved < 0) {
                throw new Error("Balance cannot go negative");
            }

            addressObj[propertyId].amount = newAmount;
            addressObj[propertyId].available = newAvailable;
            addressObj[propertyId].reserved = newReserved;
            addressObj[propertyId].vesting = newVesting
            instance.addresses.set(address, addressObj); // Update the map with the modified address object

            console.log('Updated balance for address:', address, 'with propertyId:', propertyId);
            await instance.saveToDB(); // Save changes to the database
            //console.log('new amount '+newAmount+ 'newAvailable '+newAvailable + 'newReserved'+ newReserved+'newVesting '+newVesting)
            //const blockHeight = TxIndex.fetchChainTip()
    }


      static async getAddressBalances(address) {
            const instance = await this.getInstance();

            // Check if the instance has been loaded
            if (!instance) {
                console.log('TallyMap instance is not loaded. Attempting to load from DB...');
                await instance.loadFromDB();
            } else {
                console.log('TallyMap instance already exists. Using existing instance.');
            }

            // Log the serialized form of the data from the DB
            console.log('Serialized data from DB:', JSON.stringify([...instance.addresses]));

            // Check if the address exists in the map
            if (!instance.addresses.has(address)) {
                console.log(`No data found for address: ${address}`);
                return [];
            }

            const addressObj = instance.addresses.get(address);
            console.log(`Data for address ${address}:`, addressObj);

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
                    });
                }
            }

            console.log(`Balances for address ${address}:`, balances);
            return balances;
        }


      async saveToDB() {
            const db = dbInstance.getDatabase('tallyMap');
            const serializedData = JSON.stringify([...this.addresses]);
            const tallyMapDocument = {
                _id: 'tallyMap', 
                data: serializedData
            };

            // Check if the entry exists
            const existingEntry = await db.findOneAsync({ _id: 'tallyMap' });
            console.log('about to save this '+serializedData)
            if (existingEntry) {
                await db.updateAsync({ _id: 'tallyMap' }, { $set: { data: serializedData } }, {});
            } else {
                await db.insertAsync(tallyMapDocument);
            }
    }

    async loadFromDB() {
        try {
            const query = { _id: 'tallyMap' };
            const result = await dbInstance.getDatabase('tallyMap').findOneAsync(query);

            if (result && result.data) {
                // Deserialize the data from a JSON string to an array
                const mapDataArray = JSON.parse(result.data);

                // Convert the array back into a Map
                this.addresses = new Map(mapDataArray.map(([key, value]) => [key, value]));
            } else {
                console.log('failed to load tallyMap, starting a new map')
                this.addresses = new Map(); // Ensure addresses is always a Map
            }
        } catch (error) {
            console.error('Error loading tally map from dbInstance:', error);
        }
    }


    async applyDeltasSinceLastHeight(lastHeight) {
        // Retrieve and apply all deltas from lastHeight to the current height
        for (let height = lastHeight + 1; height <= currentBlockHeight; height++) {
            const serializedDelta = await dbInstance.get(`tallyMapDelta-${height}`);
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
        return await dbInstance.getDatabase('tallyMap').insert(deltaKey, JSON.stringify(delta));
    }

// Function to apply a delta to the TallyMap
    applyDeltaToTallyMap(delta) {
        const { address, propertyId, amountChange } = delta;
        // Logic to apply the change to TallyMap
        TallyMap.updateBalance(address, propertyId, amountChange);
    }

    async saveDeltaTodbInstance(blockHeight, delta) {
        const serializedDelta = JSON.stringify(delta);
        await dbInstance.getDatabase('tallyMap').insert(`tallyMapDelta-${blockHeight}`, serializedDelta);
    }

    // Function to save the aggregated block delta
    saveBlockDelta(blockHeight, blockDelta) {
        const deltaKey = `blockDelta-${blockHeight}`;
        dbInstance.getDatabase('tallyMap').insert(deltaKey, JSON.stringify(blockDelta));
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
