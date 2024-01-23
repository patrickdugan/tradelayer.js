var dbInstance = require('./db.js')
var TxIndex = require('./txindex.js')
var PropertyList = require('./property.js')
const uuid = require('uuid');

class TallyMap {
    static instance;

    constructor(path) {
        if (!TallyMap.instance) {
            this.addresses = new Map();
            this.feeCache = new Map(); // Map for storing fees for each propertyId
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

    async verifyPropertyIds() {
        let propertyIndex = await PropertyList.getPropertyIndex()    

        for (const [address, properties] of this.addresses.entries()) {
            for (const propertyId in properties) {
                if (!this.propertyIndex.has(propertyId)) {
                    console.error(`Invalid propertyId ${propertyId} found for address ${address}`);
                    // Handle the error - either remove the invalid entry or log it for further investigation
                }
            }
        }
    }

    static async updateBalance(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, type) {
            if(availableChange==null||reservedChange==null||marginChange==null||vestingChange==null||isNaN(availableChange)||isNaN(reservedChange)||isNaN(marginChange)||isNaN(vestingChange)){
                throw new Error('Somehow null passed into updateBalance... avail. '+availableChange + ' reserved '+ reservedChange + ' margin' + marginChange + ' vesting '+vestingChange )
            }

            if (!Number.isInteger(propertyId)) {
                return Error(`Invalid propertyId: ${propertyId}`);
            }

            const instance = await this.getInstance();
            if (!instance.addresses.has(address)) {
                instance.addresses.set(address, {});
            }
            const addressObj = instance.addresses.get(address);
            console.log('addressObj being changed '+JSON.stringify(addressObj) + ' for addr '+address)
            if (!addressObj[propertyId]) {
                addressObj[propertyId] = { amount: 0, available: 0, reserved: 0, margin: 0, vesting: 0 };
            }

            // Check and update available balance
            if (addressObj[propertyId].available + availableChange < 0) {
                throw new Error("Available balance cannot go negative "+ addressObj[propertyId].available + ' change '+availableChange);
            }
            addressObj[propertyId].available += availableChange;

            // Check and update reserved balance
            if (addressObj[propertyId].reserved + reservedChange < 0) {
                console.log('propertyId, reserved, reservedChange '+JSON.stringify(addressObj[propertyId]) + ' ' +addressObj[propertyId].reserved + ' ' + reservedChange)
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
            await TallyMap.recordTallyMapDelta(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, type) 

            instance.addresses.set(address, addressObj); // Update the map with the modified address object
            console.log('Updated balance for address:', JSON.stringify(addressObj), 'with propertyId:', propertyId);
            await instance.saveToDB(); // Save changes to the database
        }


        static calculateTotal(balanceObj) {
            return balanceObj.available + balanceObj.reserved + balanceObj.margin + balanceObj.vesting;
        }

        static roundToEightDecimals(number) {
            return Math.floor(number * 1e8) / 1e8;
        }


        static async setInitializationFlag() {
            const db = dbInstance.getDatabase('tallyMap');
            await db.updateAsync(
                { _id: '$TLinit' },
                { _id: '$TLinit', initialized: true },
                { upsert: true }
            );
        }

    static async checkInitializationFlag() {
            const db = dbInstance.getDatabase('tallyMap');
            const result = await db.findOneAsync({ _id: '$TLinit' });
            if(result==undefined){return false}
            return result ? result.initialized : false;
        }


    static async getAddressBalances(address) {
            const instance = await this.getInstance();

            // Check if the instance has been loaded
            if (!instance) {
                console.log('TallyMap instance is not loaded. Attempting to load from DB...');
                await instance.loadFromDB();
            } else {
                //console.log('TallyMap instance already exists. Using existing instance.');
            }

            // Log the serialized form of the data from the DB
            //console.log('Serialized data from DB:', JSON.stringify([...instance.addresses]));

            // Check if the address exists in the map
            if (!instance.addresses.has(address)) {
                console.log(`No data found for address: ${address}`);
                return [];
            }

            const addressObj = instance.addresses.get(address);
            //console.log(`Data for address ${address}:`, addressObj);
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
            //console.log(`Balances for address ${address}:`, balances);
            return balances;
    }

    /**
     * Checks if a sender has a sufficient balance of a specific property.
     * @param {string} senderAddress - The address of the sender.
     * @param {number} propertyId - The ID of the property to check.
     * @param {number} requiredAmount - The amount required for the transaction.
     * @returns {Promise<{hasSufficient: boolean, reason: string}>} - An object indicating if the balance is sufficient and a reason if it's not.
     */
    static async hasSufficientBalance(senderAddress, propertyId, requiredAmount) {
        try {
            const senderTally = await this.getTally(senderAddress, propertyId);
            //console.log('Checking senderTally in has hasSufficientBalance', senderAddress, propertyId, JSON.stringify(senderTally));

            if (!senderTally || senderTally.available === undefined) {
                return { hasSufficient: false, reason: 'Error loading tally or tally not found' };
            }

            //console.log('Available tokens:', senderTally.available, 'Required amount:', requiredAmount);

            if (senderTally.available < requiredAmount) {
                return { hasSufficient: false, reason: 'Insufficient available balance' };
            }

            return { hasSufficient: true, reason: '' };
        } catch (error) {
            console.error('Error in hasSufficientBalance:', error);
            return { hasSufficient: false, reason: 'Unexpected error checking balance' };
        }
    }


    async saveToDB() {
        try {
            const db = dbInstance.getDatabase('tallyMap');
            const serializedData = JSON.stringify([...this.addresses]);

            // Use upsert option
            await db.updateAsync({ _id: 'tallyMap' }, { $set: { data: serializedData } }, { upsert: true });
            console.log('TallyMap saved successfully.');
        } catch (error) {
            console.error('Error saving TallyMap:', error);
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

     // Method to save fee cache to the database
     static async saveFeeCacheToDB() {
        try {
            const db = dbInstance.getDatabase('feeCache');
            for (let [propertyId, feeAmount] of this.feeCache.entries()) {
                const serializedFeeAmount = JSON.stringify(feeAmount);
                await db.updateAsync(
                    { _id: 'feeCache-' + propertyId },
                    { _id: 'feeCache-' + propertyId, value: serializedFeeAmount },
                    { upsert: true }
                );
            }
            console.log('FeeCache saved successfully.');
        } catch (error) {
            console.error('Error saving FeeCache:', error);
        }
    }

    
    static async loadFeeCacheFromDB() {
        let propertyIndex = await PropertyList.getPropertyIndex()    
        try {
            const db = dbInstance.getDatabase('feeCache');
            this.feeCache = new Map();

            // Assuming you have a list of property IDs, iterate through them
            for (let id of propertyIndex) {
                const query = { _id: 'feeCache-' + propertyIndex.id };
                const result = await db.findOneAsync(query);
                if (result && result.value) {
                    const feeAmount = JSON.parse(result.value);
                    this.feeCache.set(propertyId, feeAmount);
                }
            }
            console.log('FeeCache loaded successfully.');
        } catch (error) {
            console.error('Error loading fee cache from dbInstance:', error);
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

     // Method to update fee cache for a property
    static async updateFeeCache(propertyId, feeAmount) {
        await this.loadFeeCacheFromDB();


        if (!this.feeCache.has(propertyId)) {
            this.feeCache.set(propertyId, 0); // Initialize if not present
        }
        const currentFee = this.feeCache.get(propertyId);
        this.feeCache.set(propertyId, currentFee + feeAmount);

        // Optionally, persist fee cache changes to database if necessary
        await this.saveFeeCacheToDB(); 
    }

    static async drawOnFeeCache(propertyId) {
        await this.loadFeeCacheFromDB();

        if (!this.feeCache.has(propertyId)) {
            console.log(`No fee cache available for property ID ${propertyId}`);
            return;
        }

        const feeAmount = this.feeCache.get(propertyId);
        if (feeAmount <= 0) {
            console.log(`Insufficient fee cache for property ID ${propertyId}`);
            return;
        }

        // Logic to match with standing sell orders of property ID 1
        // Adjust this logic based on how you handle order matching
        // ...

        // Deduct the matched amount from the fee cache
        this.feeCache.set(propertyId, this.feeCache.get(propertyId) - matchedAmount);

        // Insert the purchased property ID 1 units into the insurance fund
        // Adjust this logic to match your insurance fund implementation
        // ...

        // Save the updated fee cache to the database
        await this.saveFeeCacheToDB();
    }

    // Function to record a delta
     static async recordTallyMapDelta(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, type){
        const newUuid = uuid.v4();
        const db = dbInstance.getDatabase('tallyMapDelta');
        const deltaKey = `${address}-${propertyId}-${newUuid}`;
        const delta = { address, property: propertyId, avail: availableChange, res: reservedChange, mar: marginChange, vest: vestingChange, type };
        
        console.log('saving delta ' + JSON.stringify(delta));

        try {
            // Try to find an existing document based on the key
            const existingDocument = await db.findOneAsync({ _id: deltaKey });

            if (existingDocument) {
                // If the document exists, update it
                await db.updateAsync({ _id: deltaKey }, { $set: { data: delta } });
            } else {
                // If the document doesn't exist, insert a new one
                await db.insertAsync({ _id: deltaKey, data: delta });
            }

            return; // Return success or handle as needed
        } catch (error) {
            console.error('Error saving delta:', error);
            throw error; // Rethrow the error or handle as needed
        }
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
            //console.log("can't find address in tallyMap")
            return 0;
        }
        const addressObj = instance.addresses.get(address);
        if (!addressObj[propertyId]) {
            //console.log("can't find property in address "+address+propertyId+ ' '+JSON.stringify(addressObj) )
            return 0;
        }
        return {amount: addressObj[propertyId].amount, 
            available: addressObj[propertyId].available, 
            reserved: addressObj[propertyId].reserved, 
            margined: addressObj[propertyId].margined, 
            vesting:addressObj[propertyId].vesting}; // or other specific fields like available, reserved
    }

    getAddressBalances(address) {
        //console.log('ze tally map'+this.addresses)
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
    static getAddressesWithBalanceForProperty(propertyId) {
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
