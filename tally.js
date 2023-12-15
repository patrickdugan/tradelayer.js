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
    static async getInstance() {
        if (!TallyMap.instance) {
            TallyMap.instance = new TallyMap();
        }
        await TallyMap.instance.loadFromDB();
        return TallyMap.instance;
    }

    verifyPropertyIds() {
        for (const [address, properties] of this.addresses.entries()) {
            for (const propertyId in properties) {
                if (!this.propertyIndex.has(propertyId)) {
                    console.error(`Invalid propertyId ${propertyId} found for address ${address}`);
                    // Handle the error - either remove the invalid entry or log it for further investigation
                }
            }
        }
    }
    
    static async updateBalance(address, propertyId, availableChange, reservedChange, marginChange, vestingChange) {
            console.log(propertyId, availableChange, reservedChange)
            if (!Number.isInteger(propertyId)) {
                return Error(`Invalid propertyId: ${propertyId}`);
            }

            const instance = await this.getInstance();
            if (!instance.addresses.has(address)) {
                instance.addresses.set(address, {});
            }
            const addressObj = instance.addresses.get(address);

            if (!addressObj[propertyId]) {
                addressObj[propertyId] = { amount: 0, available: 0, reserved: 0, margin: 0, vesting: 0 };
            }

            // Check and update available balance
            if (addressObj[propertyId].available + availableChange < 0) {
                throw new Error("Available balance cannot go negative");
            }
            addressObj[propertyId].available += availableChange;

            // Check and update reserved balance
            if (addressObj[propertyId].reserved + reservedChange < 0) {
                console.log(JSON.stringify(addressObj[propertyId]) + ' ' +addressObj[propertyId].reserved + ' ' + reservedChange)
                throw new Error("Reserved balance cannot go negative "+propertyId + ' '+availableChange+' '+ reservedChange);
            }
            addressObj[propertyId].reserved += reservedChange;

            // Check and update margin balance
            if (addressObj[propertyId].margin + marginChange < 0) {
                throw new Error("Margin balance cannot go negative");
            }
            addressObj[propertyId].margin += marginChange;

            // Check and update vesting balance
            if (addressObj[propertyId].vesting + vestingChange < 0) {
                throw new Error("Vesting balance cannot go negative");
            }
            addressObj[propertyId].vesting += vestingChange;

            // Update the total amount
            addressObj[propertyId].amount = this.calculateTotal(addressObj[propertyId]);

            instance.addresses.set(address, addressObj); // Update the map with the modified address object
            console.log('Updated balance for address:', address, 'with propertyId:', propertyId);
            await instance.saveToDB(); // Save changes to the database
        }


        static calculateTotal(balanceObj) {
            return balanceObj.available + balanceObj.reserved + balanceObj.margin + balanceObj.vesting;
        }

        static roundToEightDecimals(number) {
            return Math.floor(number * 1e8) / 1e8;
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
                //console.log('failed to load tallyMap, starting a new map')
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
    static async getTally(address, propertyId) {
        const instance = await TallyMap.getInstance(); // Ensure instance is loaded
        if (!instance.addresses.has(address)) {
            return 0;
        }
        const addressObj = instance.addresses.get(address);
        if (!addressObj[propertyId]) {
            return 0;
        }
        return {amount: addressObj[propertyId].amount, 
            available: addressObj[propertyId].available, 
            reserved: addressObj[propertyId].reserved, 
            margined: addressObj[propertyId].margined, 
            vesting:addressObj[propertyId].vesting}; // or other specific fields like available, reserved
    }

    getAddressBalances(address) {
        console.log('ze tally map'+this.addresses)
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
