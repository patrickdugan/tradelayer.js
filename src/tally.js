var dbInstance = require('./db.js')
var TxIndex = require('./txIndex.js')
var TxUtils = require('./txUtils.js')
var PropertyList = require('./property.js')
const uuid = require('uuid');
const BigNumber = require('bignumber.js');

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

    static async updateBalance(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, type, block) {
            console.log('inside updateBalance for '+address, propertyId, availableChange, reservedChange, marginChange, vestingChange, type, block)
            if(availableChange==null||reservedChange==null||marginChange==null||vestingChange==null||isNaN(availableChange)||isNaN(reservedChange)||isNaN(marginChange)||isNaN(vestingChange)){
                throw new Error('Somehow null passed into updateBalance... avail. '+availableChange + ' reserved '+ reservedChange + ' margin' + marginChange + ' vesting '+vestingChange )
            }

            if (typeof propertyId === 'string' && propertyId.startsWith('s-')) {
                    // Handle synthetic token
            } else if (!Number.isInteger(propertyId)) {
                    return Error(`Invalid propertyId: ${propertyId}`);
            }


            if (typeof availableChange !== 'number'){
                console.log(`string passed in: ${availableChange}`);
                availableChange = new BigNumber(availableChange).toNumber()
                 console.log('new availableChange '+availableChange)
            }
            if(typeof reservedChange !== 'number'){
                console.log(`string passed in: ${reservedChange}`);
                reservedChange = new BigNumber(reservedChange).toNumber()
            }
            if(typeof marginChange !== 'number'){
                console.log(`string passed in: ${marginChange}`);
                marginChange = new BigNumber(marginChange).toNumber()
                console.log('new margin Change '+marginChange)
            }
            if(typeof vestingChange !== 'number'){
                console.log(`string passed in: ${vestingChange}`);
                vestingChange = new BigNumber(vestingChange).toNumber()
            }

            const instance = await this.getInstance();
            if (!instance.addresses.has(address)) {
                instance.addresses.set(address, {});
            }
            const addressObj = instance.addresses.get(address);
            
            //console.log('addressObj being changed '+propertyId + ' for addr '+Boolean(addressObj[propertyId]))

            if (!addressObj[propertyId]) {
                addressObj[propertyId] = { amount: 0, available: 0, reserved: 0, margin: 0, vesting: 0 };
            }

            // Check and update available balance
            // Assuming addressObj[propertyId] and the respective change variables are already BigNumber instances
            // Example for available balance

            const originalAvailableBalance = new BigNumber(addressObj[propertyId].available);
            const newAvailableBalance = originalAvailableBalance.plus(availableChange);
            console.log('avail. balance change '+originalAvailableBalance, newAvailableBalance.toNumber(),availableChange)
            if (newAvailableBalance.isLessThan(0)) {
                throw new Error("Available balance cannot go negative " + originalAvailableBalance.toString() + ' change ' + availableChange.toString());
            }

            addressObj[propertyId].available = newAvailableBalance.toNumber();

            // Repeat the pattern for reserved, margin, and vesting balances

            // Example for reserved balance
            const originalReservedBalance = new BigNumber(addressObj[propertyId].reserved);
            const newReservedBalance = originalReservedBalance.plus(reservedChange);
            console.log('reserve. balance change '+originalReservedBalance, newReservedBalance.toNumber(),availableChange)
        
            if (newReservedBalance.isLessThan(0)) {
                throw new Error("Reserved balance cannot go negative " + originalReservedBalance.toString() + ' change ' + reservedChange.toString());
            }

            addressObj[propertyId].reserved = newReservedBalance.toNumber();

            // Example for margin balance
            const originalMarginBalance = new BigNumber(addressObj[propertyId].margin);
            const newMarginBalance = originalMarginBalance.plus(marginChange);

            if (newMarginBalance.isLessThan(0)) {
                throw new Error("Margin balance cannot go negative " + originalMarginBalance.toString() + ' change ' + marginChange.toString());
            }

            addressObj[propertyId].margin = newMarginBalance.toNumber();

            // Example for vesting balance
            const originalVestingBalance = new BigNumber(addressObj[propertyId].vesting);
            const newVestingBalance = originalVestingBalance.plus(vestingChange);

            if (newVestingBalance.isLessThan(0)) {
                throw new Error("Vesting balance cannot go negative " + originalVestingBalance.toString() + ' change ' + vestingChange.toString());
            }

            addressObj[propertyId].vesting = newVestingBalance.toNumber();

            // Update the total amount
            addressObj[propertyId].amount = this.calculateTotal(addressObj[propertyId]);

            if (typeof addressObj[propertyId].channelBalance === 'undefined') {
                addressObj[propertyId].channelBalance = 0;
            }


            if(availableChange==0&&reservedChange==0&&marginChange==0&&vestingChange==0){

            }else{
                await TallyMap.recordTallyMapDelta(address, block, propertyId, addressObj[propertyId].amount, availableChange, reservedChange, marginChange, vestingChange, 0, type) 
            }
            instance.addresses.set(address, addressObj); // Update the map with the modified address object
            //console.log('Updated balance for address:', JSON.stringify(addressObj), 'with propertyId:', propertyId);
            await instance.saveToDB(); // Save changes to the database
        }

        static async updateChannelBalance(address, propertyId, channelChange, type,block) {
            const instance = await this.getInstance();
            
            // Initialize the address if it doesn't exist
            if (!instance.addresses.has(address)) {
                instance.addresses.set(address, {});
            }
            const addressObj = instance.addresses.get(address);
            
            // Initialize the propertyId if it doesn't exist
            if (!addressObj[propertyId]) {
                addressObj[propertyId] = { amount: 0, available: 0, reserved: 0, margin: 0, vesting: 0, channelBalance: 0 };
            }
            
            // Handle undefined channel balance and set it to 0 if necessary
            if (typeof addressObj[propertyId].channelBalance === 'undefined') {
                addressObj[propertyId].channelBalance = 0;
            }
            
            // Update channel balance
            const originalChannelBalance = new BigNumber(addressObj[propertyId].channelBalance);
            const newChannelBalance = originalChannelBalance.plus(channelChange);
            
            if (newChannelBalance.isLessThan(0)) {
                throw new Error(`Channel balance cannot go negative for property ${propertyId}`);
            }

            // Update the channel balance
            addressObj[propertyId].channelBalance = newChannelBalance.toNumber();
            addressObj[propertyId].amount = this.calculateTotal(addressObj[propertyId]);
            // Record the channel balance change
            if (channelChange !== 0) {
                await TallyMap.recordTallyMapDelta(
                    address, 
                    block, 
                    propertyId, 
                    addressObj[propertyId].amount, 
                    0, // No change in available
                    0, // No change in reserved
                    0, // No change in margin
                    0, // No change in vesting
                    channelChange, 
                    type
                );
            }

            // Save the updated object back to the map
            instance.addresses.set(address, addressObj);
            await instance.saveToDB(); // Save the updated balance to the database
        }


        static calculateTotal(balanceObj) {
            return BigNumber(balanceObj.available).plus(balanceObj.reserved).plus(balanceObj.margin).plus(balanceObj.channel).decimalPlaces(8).toNumber();
        }

        static roundToEightDecimals(number) {
            return Math.floor(number * 1e8) / 1e8;
        }


        static async setInitializationFlag() {
            const db = await dbInstance.getDatabase('tallyMap');
            await db.updateAsync(
                { _id: '$TLinit' },
                { _id: '$TLinit', initialized: true },
                { upsert: true }
            );
        }

    static async checkInitializationFlag() {
            const db = await dbInstance.getDatabase('tallyMap');
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
                const info = await PropertyList.getPropertyData(propertyId)
                if (Object.hasOwnProperty.call(addressObj, propertyId)) {
                    const balanceObj = addressObj[propertyId];
                    console.log(propertyId, JSON.stringify(balanceObj),JSON.stringify(info))
                    balances.push({
                        propertyId: propertyId,
                        ticker: info.ticker,
                        amount: balanceObj.amount,
                        available: balanceObj.available,
                        reserved: balanceObj.reserved,
                        margin: balanceObj.margin,
                        vesting: balanceObj.vesting,
                        channel: balanceObj.channelBalance
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
            console.log('Checking senderTally in has hasSufficientBalance', senderAddress, propertyId, requiredAmount, JSON.stringify(senderTally));

            if (!senderTally || senderTally.available === undefined) {
                return { hasSufficient: false, reason: 'undefined' };
            }

            //console.log('Available tokens:', senderTally.available, 'Required amount:', requiredAmount);

            if (senderTally.available < requiredAmount) {
                return { hasSufficient: false, reason: 'Insufficient available balance', shortfall: requiredAmount-senderTally.available, available:senderTally.available };
            }

            return { hasSufficient: true, reason: '' };
        } catch (error) {
            console.error('Error in hasSufficientBalance:', error);
            return { hasSufficient: false, reason: 'Unexpected error checking balance' };
        }
    }

    static async hasSufficientReserve(senderAddress, propertyId, requiredAmount) {
        try {
            const senderTally = await this.getTally(senderAddress, propertyId);
            console.log('Checking senderTally in has hasSufficientReserve', senderAddress, propertyId, requiredAmount, JSON.stringify(senderTally));

            if (!senderTally || senderTally.reserved === undefined) {
                return { hasSufficient: false, reason: 'undefined' };
            }

            console.log('Reserve tokens:', senderTally.reserved, 'Required amount:', requiredAmount);

            if (senderTally.reserved < requiredAmount) {
                let requiredBN = new BigNumber(requiredAmount)
                let reservedBN = new BigNumber(senderTally.reserved)
                let shortfall= requiredBN.minus(reservedBN).toNumber()
                console.log('insufficient tokens ' +shortfall)
                return { hasSufficient: false, reason: 'Insufficient available balance', shortfall: shortfall };
            }

            return { hasSufficient: true, reason: '' };
        } catch (error) {
            console.error('Error in hasSufficientBalance:', error);
            return { hasSufficient: false, reason: 'Unexpected error checking balance' };
        }
    }

    static async hasSufficientChannel(senderAddress, propertyId, requiredAmount) {
        try {
            const senderTally = await this.getTally(senderAddress, propertyId);
            console.log('Checking senderTally in has hasSufficientChannel', senderAddress, propertyId, requiredAmount, JSON.stringify(senderTally));

            if (!senderTally || senderTally.reserved === undefined) {
                return { hasSufficient: false, reason: 'undefined' };
            }

            console.log('Channel tokens:', senderTally.channel, 'Required amount:', requiredAmount);

            if (senderTally.channel < requiredAmount) {
                let requiredBN = new BigNumber(requiredAmount)
                let channelBN = new BigNumber(senderTally.channel)
                let shortfall= requiredBN.minus(channelBN).toNumber()
                console.log('insufficient tokens ' +shortfall)
                return { hasSufficient: false, reason: 'Insufficient available balance', shortfall: shortfall };
            }

            return { hasSufficient: true, reason: '' };
        } catch (error) {
            console.error('Error in hasSufficientBalance:', error);
            return { hasSufficient: false, reason: 'Unexpected error checking balance' };
        }
    }

    async saveToDB() {
        try {
            const db = await dbInstance.getDatabase('tallyMap');
            const serializedData = JSON.stringify([...this.addresses]);
            console.log('saving tallymap')
            // Use upsert option
            await db.updateAsync({ _id: 'tallyMap' }, { $set: { data: serializedData } }, { upsert: true });
            //console.log('TallyMap saved successfully.');
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

   static async saveFeeCacheToDB(propertyId, feeAmount) {
        if (propertyId === undefined || feeAmount === undefined) {
            console.error('Property ID or fee amount is undefined.');
            return;
        }

        console.log('Inside save fee cache ' + propertyId + ' ' + feeAmount);

        const db = await dbInstance.getDatabase('feeCache');
        try {
            const serializedFeeAmount = JSON.stringify(feeAmount);
            
            // Convert propertyId to a string if it's not already a string
            const cacheId = String(propertyId);

            await db.updateAsync(
                { _id: cacheId }, // Query to find the document
                { $set: { value: serializedFeeAmount } }, // Update the value field
                { upsert: true } // Insert a new document if it doesn't exist
            );
            console.log('FeeCache for property ' + propertyId + ' saved successfully.');
        } catch (error) {
            console.error('Error saving FeeCache:', error);
        }
    }


    static async loadFeeCacheFromDB() {
        let propertyIndex = await PropertyList.getPropertyIndex();    
        try {
            const db = await dbInstance.getDatabase('feeCache');
            this.feeCache = new Map();

            // Assuming you have a list of property IDs, iterate through them
            for (let id of propertyIndex) {
                const query = { _id: id.id.toString() }; // Corrected typo here
                const result = await db.findOneAsync(query);
                //console.log(result, id.id)
                if (result && result.value) {
                    const feeAmount = JSON.parse(result.value);
                    this.feeCache.set(id, feeAmount); // Using `id` instead of `propertyIndex.id`
                }
            }
            
            return this.feeCache;
        } catch (error) {
            console.error('Error loading fee cache from dbInstance:', error);
        }
    }

    static async loadFeeCacheForProperty(id) {    
        try {
            const db = await dbInstance.getDatabase('feeCache');

            const result = await db.findAsync({});
            console.log('Database contents:', JSON.stringify(result, null, 2));

            let value = 0;
            for (const doc of result) {
                console.log(JSON.stringify(doc))
                if (doc._id == id) {
                    value = parseFloat(doc.value);
                    console.log('FeeCache loaded for property ' + id + ': ' + value);
                    break;
                }
            }

            if (value === 0) {
                console.log('No FeeCache found for property ' + id);
            }

            return value;
        } catch (error) {
            console.error('Error loading fee cache from dbInstance:', error);
            return 0; // Return a default value in case of error
        }
    }

    // Method to update fee cache for a property
    static async updateFeeCache(propertyId, feeAmount) {
        // Load current fee from the fee cache
        let currentFee = await this.loadFeeCacheForProperty(propertyId);

        console.log('current fee: ' + currentFee + ', propertyId: ' + propertyId+'fee to update '+feeAmount);

        // Check if currentFee is undefined (no existing fee)
        if (currentFee === undefined||currentFee==0||isNaN(currentFee)) {
            currentFee = 0; // Set currentFee to 0 if it's undefined
        }

        // Update the fee cache by adding the new fee amount
        let updatedFee = currentFee + feeAmount;
        this.feeCache.set(propertyId, updatedFee);

        console.log('Updated fee cache for property ' + propertyId + ': ' + updatedFee);

        // Optionally, persist fee cache changes to the database if necessary
        await this.saveFeeCacheToDB(propertyId, updatedFee);
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
    static async recordTallyMapDelta(address, block, propertyId, total, availableChange, reservedChange, marginChange, vestingChange, channelChange, type){
        const newUuid = uuid.v4();
        const db = await dbInstance.getDatabase('tallyMapDelta');
        let deltaKey = `${address}-${propertyId}-${newUuid}`;
        deltaKey+='-'+block
        const delta = { address, block, property: propertyId, total: total, avail: availableChange, res: reservedChange, mar: marginChange, vest: vestingChange, channel: channelChange, type };
        
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
        await dbInstance.getDatabase('tallyMap').insert(deltaKey, JSON.stringify(blockDelta));
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
        console.log('inside getTally '+propertyId+' '+JSON.stringify(addressObj))
        if (!addressObj[propertyId]) {
            console.log("can't find property in address "+address+propertyId+ ' '+JSON.stringify(addressObj) )
            return 0;
        }

        const returnObj = {amount: addressObj[propertyId].amount, 
            available: addressObj[propertyId].available, 
            reserved: addressObj[propertyId].reserved, 
            margin: addressObj[propertyId].margin, 
            vesting:addressObj[propertyId].vesting,
            channel: addressObj[propertyId].channelBalance}

            console.log('return obj '+JSON.stringify(returnObj))

        return returnObj
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
    static async getAddressesWithBalanceForProperty(propertyId) {
            const addressesWithBalances = [];

            try {
                // Get the tallyMap document
                const tallyMapDoc = await dbInstance.getDatabase('tallyMap').findOneAsync({ _id: 'tallyMap' });

                // Ensure we got the document and the data field exists
                if (!tallyMapDoc || !tallyMapDoc.data) {
                    console.error('No tallyMap document found or data is missing');
                    return addressesWithBalances;
                }

                // Parse the stringified data into a usable array
                const parsedData = JSON.parse(tallyMapDoc.data);

                // Iterate over the parsed data and find addresses with the specified propertyId
                for (const [address, balances] of parsedData) {
                    if (balances[propertyId]) {
                        const balanceInfo = balances[propertyId];
                        if (balanceInfo.available > 0 || balanceInfo.vesting > 0) {
                            addressesWithBalances.push({
                                address: address,
                                available: balanceInfo.available,
                                reserved: balanceInfo.reserved,
                                margin: balanceInfo.margin,
                                vesting: balanceInfo.vesting,
                                channelBalance: balanceInfo.channelBalance
                            });
                        }
                    }
                }

                console.log('Found addresses for property', propertyId, addressesWithBalances);
            } catch (error) {
                console.error('Error querying addresses with balance for propertyId:', propertyId, error);
            }

            return addressesWithBalances;
        }

    static async applyVesting(propertyId, vestingAmount, block) {
        console.log('insideApply vesting '+vestingAmount)
        if(vestingAmount<1e-8){return}
        // Get the list of addresses with balances for the given propertyId
        const addressesWithBalances = await this.getAddressesWithBalanceForProperty(propertyId);
        const propertyInfo = await PropertyList.getPropertyData(propertyId)
        // Retrieve the total number of tokens for the propertyId from the propertyList
        const totalTokens = propertyInfo.totalInCirculation;
        vestingAmount = new BigNumber(vestingAmount)
        // Iterate over each address to apply the vesting amount
        for (const { address, available, reserved, margin, vesting, channelBalance } of addressesWithBalances) {
            console.log(JSON.stringify(addressesWithBalances))
            console.log('inside apply vesting '+address+' '+available+' '+vesting+' '+totalTokens)
            // Calculate the total balance for this address (amount + reserved)
            const totalBalanceForAddress = new BigNumber(available);

            // Calculate the percentage this balance represents of the total tokens
            const percentageOfTotalTokens = totalBalanceForAddress.dividedBy(totalTokens);
            console.log('percentage '+percentageOfTotalTokens, vestingAmount)
            // Apply the vesting amount proportionally to this address
            const vestingShare = vestingAmount.multipliedBy(percentageOfTotalTokens);
            console.log(vestingAmount)
            console.log(vestingShare.toNumber()+' '+totalBalanceForAddress+' '+percentageOfTotalTokens)
            // Depending on propertyId, apply the vesting rules:
            if (propertyId === 2) {
                // Move tokens from vesting in propertyId 2 to available in propertyId 1
                await this.updateBalance(
                    address, 2, 0, 0, 0, vestingShare.negated().toNumber(), 'vestingDebit', block // Debit vesting from propertyId 2
                );
                await this.updateBalance(
                    address, 1, vestingShare.toNumber(), 0, 0, 0, 'vestingCredit', block // Credit available in propertyId 1
                );
            } else if (propertyId === 3) {
                // Move tokens from vesting in propertyId 3 to available in propertyId 4
                await this.updateBalance(
                    address, 3, 0, 0, 0, vestingShare.negated().toNumber(), 'vestingDebit', block // Debit vesting from propertyId 3
                );
                await this.updateBalance(
                    address, 4, vestingShare.toNumber(), 0, 0, 0, 'vestingCredit', block // Credit available in propertyId 4
                );
            }
        }
        return
    }
}

module.exports = TallyMap;
