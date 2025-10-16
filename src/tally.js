var dbInstance = require('./db.js')
var TxUtils = require('./txUtils.js')
var PropertyList = require('./property.js')
const uuid = require('uuid');
const BigNumber = require('bignumber.js');
const Insurance = require('./insurance.js')

function toSats(x){ return new BigNumber(x).multipliedBy(1e8).integerValue(BigNumber.ROUND_FLOOR); }
function fromSats(s) { return new BigNumber(s).dividedBy(1e8); }

class TallyMap {
    static instance;

    constructor(path) {
        if (!TallyMap.instance) {
            this.addresses = new Map();
            this.feeCache = new Map(); // Map for storing fees for each propertyId
            TallyMap.instance = this;
            this.modFlag = false
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

    static async setModFlag(flag){
        this.modFlag = flag
        return
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

    static async updateBalance(address, propertyId, availableChange, reservedChange, marginChange, vestingChange, type, block,txid) {
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
            
            console.log('addressObj being changed '+propertyId + ' for addr '+JSON.stringify(addressObj[propertyId]))

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
            console.log('old and new margin balance '+originalMarginBalance+' '+newMarginBalance)                
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
                await TallyMap.recordTallyMapDelta(address, block, propertyId, addressObj[propertyId].amount, availableChange, reservedChange, marginChange, vestingChange, 0, type,txid) 
            }
            instance.addresses.set(address, addressObj); // Update the map with the modified address object
            //console.log('Updated balance for address:', JSON.stringify(addressObj), 'with propertyId:', propertyId);
            await instance.saveToDB(block); // Save changes to the database
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
            await instance.saveToDB(block); // Save the updated balance to the database
        }

        static async getTotalForProperty(propertyId) {
            const instance = await TallyMap.getInstance();
            let totalBalance = new BigNumber(0);

            // Convert propertyId to a string to match stored keys
            const propertyKey = String(propertyId);

            // Iterate over all addresses in tallyMap
            for (const [address, properties] of instance.addresses.entries()) {
                
                if (properties[propertyKey]) {
                    const balance = properties[propertyKey];

                    // Ensure all balance components are properly defined
                    const available = new BigNumber(balance.available || 0);
                    const reserved = new BigNumber(balance.reserved || 0);
                    const margin = new BigNumber(balance.margin || 0);
                    const channel = new BigNumber(balance.channelBalance || 0);
                    if (available.isNaN() || reserved.isNaN() || margin.isNaN() || channel.isNaN()) {
                        console.error(`🚨 NaN detected in balance calculation for property ${propertyKey}`, {
                            available: available.toFixed(),
                            reserved: reserved.toFixed(),
                            margin: margin.toFixed(),
                            channel: channel.toFixed(),
                        });
                        continue; // Skip this entry
                    }

                    // Add up all the valid balances
                    totalBalance = totalBalance.plus(available).plus(reserved).plus(margin).plus(channel);
                }
            }

            return totalBalance;
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
            if(!instance){
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
                //console.log('bleh' +propertyId+' '+JSON.stringify(addressObj))
                const info = await PropertyList.getPropertyData(propertyId)
                if (Object.hasOwnProperty.call(addressObj, propertyId)) {
                    const balanceObj = addressObj[propertyId];
                    let ticker = ''
                    if(info!=null&&info.ticker){ticker=info.ticker}
                    //console.log(propertyId, JSON.stringify(balanceObj),JSON.stringify(info))
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
     * Retrieves the total tally for a given property ID across all addresses.
     * @param {number|string} propertyId - The property ID to aggregate balances for.
     * @returns {Promise<Object>} - An object representing the total tally for the given property.
     */
    static async getTotalTally(propertyId) {
        const instance = await TallyMap.getInstance();
        const totalTally = {
            amount: 0,
            available: 0,
            reserved: 0,
            margin: 0,
            vesting: 0,
            channelBalance: 0
        };

        for (const properties of instance.addresses.values()) {
            if (properties[propertyId]) {
                totalTally.amount += properties[propertyId].amount || 0;
                totalTally.available += properties[propertyId].available || 0;
                totalTally.reserved += properties[propertyId].reserved || 0;
                totalTally.margin += properties[propertyId].margin || 0;
                totalTally.vesting += properties[propertyId].vesting || 0;
                totalTally.channelBalance += properties[propertyId].channelBalance || 0;
            }
        }

        return totalTally;
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

            if(!senderTally || senderTally.available === undefined||senderTally==0){
                return { hasSufficient: false, reason: 'undefined', shortfall: requiredAmount };
            }

            //console.log('Available tokens:', senderTally.available, 'Required amount:', requiredAmount);
            if(senderTally.available < requiredAmount){
                const availBN = new BigNumber(senderTally.available)
                const shortfall = new BigNumber(requiredAmount).minus(availBN).decimalPlaces(8).toNumber()
                console.log('shortfall calc '+requiredAmount+' '+senderTally.available+' '+shortfall)
                return { hasSufficient: false, reason: 'Insufficient available balance', shortfall:shortfall, available:senderTally.available };
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
                return { hasSufficient: false, reason: 'undefined', shortfall: requiredAmount };
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

    static async hasSufficientMargin(senderAddress, propertyId, requiredAmount) {
        try {
            const senderTally = await this.getTally(senderAddress, propertyId);
            console.log('Checking senderTally in has hasSufficientMargin', senderAddress, propertyId, requiredAmount, JSON.stringify(senderTally));

            if (!senderTally || senderTally.margin === undefined) {
                return { hasSufficient: false, reason: 'undefined', shortfall: requiredAmount };
            }

            console.log('Margin tokens:', senderTally.margin, 'Required amount:', requiredAmount);

            if (senderTally.margin < requiredAmount) {
                let requiredBN = new BigNumber(requiredAmount)
                let marginBN = new BigNumber(senderTally.margin)
                let shortfall= requiredBN.minus(marginBN).toNumber()
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

            if (!senderTally || senderTally.channel === undefined) {
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

    async saveToDB(block) {
        try {
            const db = await dbInstance.getDatabase('tallyMap');
            const serializedData = JSON.stringify([...this.addresses]);
            console.log('saving tallymap')
            // Use upsert option
            await db.updateAsync({ _id: 'tallyMap' }, { $set: {block: block, data: serializedData } }, { upsert: true });
            //console.log('TallyMap saved successfully.');
        } catch (error) {
            console.error('Error saving TallyMap:', error);
        }
    }

    async loadFromDB() {
        try {
            const query = { _id: 'tallyMap' };
            const db = await dbInstance.getDatabase('tallyMap')
            const result = await db.findOneAsync(query);

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

   static async saveFeeCacheToDB(propertyId, feeAmount, contractid) {
        if (propertyId === undefined || feeAmount === undefined) {
            console.error('Property ID or fee amount is undefined.');
            return;
        }
        console.log('Inside save fee cache ' + propertyId + ' ' + feeAmount);
        const db = await dbInstance.getDatabase('feeCache');
        try {
           const roundedFee = Number(new BigNumber(feeAmount).toFixed(8));  // ✅ Ensures max 8 decimal places
            const serializedFeeAmount = roundedFee
            // Convert propertyId to a string if it's not already a string
            const cacheId = String(propertyId)+String(contractid);

            await db.updateAsync(
                { _id: cacheId }, // Query to find the document
                { $set: { value: serializedFeeAmount, contract: contractid } }, // Update the value field
                { upsert: true } // Insert a new document if it doesn't exist
            );
            console.log('FeeCache for property ' + propertyId + ' saved successfully.');
        } catch (error) {
            console.error('Error saving FeeCache:', error);
        }
    }

    static async loadFeeCacheFromDB() {
        let fees = new Map();

        try {
            const db = await dbInstance.getDatabase('feeCache');
            const results = await db.findAsync({});

            if (!results || results.length === 0) {
                //console.log("⚠️ No fee cache entries found.");
                return fees;
            }

            //console.log(`✅ Loaded ${results.length} fee cache entries.`);

            for (let result of results) {
                //console.log(`📝 DB Entry: ${JSON.stringify(result)}`);

                if (!result._id) {
                    console.warn(`⚠️ Skipping malformed entry (missing _id): ${JSON.stringify(result)}`);
                    continue;
                }

                if (typeof result.value === "undefined") {
                    console.warn(`⚠️ Skipping entry with undefined value: ${JSON.stringify(result)}`);
                    continue;
                }
                if(!result.stash){result.stash=0}
                let feeData = {
                    value: parseFloat(result.value), // ✅ Ensure value is a number
                    contract: result.contract || null,
                    stash: parseFloat(result.stash)
                };

                //console.log(`🔹 Fee Cache Parsed - Key: ${result._id}, Value: ${feeData.value}, Contract: ${feeData.contract}`);

                fees.set(result._id, feeData);
            }
        } catch (error) {
            console.error(`🚨 Error loading fee cache:`, error);
        }

        return fees;
    }


static async loadFeeCacheForProperty(id) {
    try {
        const db = await dbInstance.getDatabase('feeCache');
        const result = await db.findAsync({});
        console.log('📄 Database contents:', JSON.stringify(result, null, 2));

        let total = new BigNumber(0);

        for (const doc of result) {
            if (doc._id.startsWith(`${id}-`)) {
                const value = new BigNumber(doc.value || 0);
                const stash = new BigNumber(doc.stash || 0);
                total = total.plus(value).plus(stash);
                console.log(`➕ Matched ${doc._id}: value=${value.toFixed()}, stash=${stash.toFixed()}, running total=${total.toFixed()}`);
            }
        }

        console.log(`✅ FeeCache total for property ${id}: ${total.toFixed()}`);
        return total;
    } catch (error) {
        console.error('❌ Error loading fee cache from dbInstance:', error);
        return new BigNumber(0);
    }
}

    // Method to update fee cache for a property
    // tally.js

    static async resolveBlock(explicitBlock) {
      if (explicitBlock !== undefined && explicitBlock !== null) return explicitBlock;
      try {
        const consensus = await dbInstance.getDatabase('consensus');
        const t = await consensus.findOneAsync({ _id: 'TrackHeight' });
        const m = await consensus.findOneAsync({ _id: 'MaxProcessedHeight' });
        return (t && t.value) || (m && m.value) || null;
      } catch { return null; }
    }

    static async loadFeeRow(db, cacheId) {
      const row = await db.findOneAsync({ _id: cacheId });
      return {
        value: new BigNumber(row ? row.value || 0 : 0),
        stash: new BigNumber(row ? row.stash || 0 : 0),
        contract: row ? row.contract : undefined,
      };
    }
    static async saveFeeRow(db, cacheId, { value, stash, contract }) {
      await db.updateAsync(
        { _id: cacheId },
        {
          $set: {
            value: new BigNumber(value).decimalPlaces(8).toNumber(),
            stash: new BigNumber(stash).decimalPlaces(8).toNumber(),
            contract: contract,
          },
        },
        { upsert: true }
      );
    }

    /**
     * NEW: accrueFee(propertyId, amount>0, contractId|null, block?)
     * - spot (contractId == null): 50% to Insurance(Contract 1, Prop 1) now, 50% to VALUE for `${propertyId}-1`
     * - oracle (non-native): 50% to contract insurance now, remainder to STASH on `${propertyId}-${contractId}`
     * - native: 100% to VALUE on `${propertyId}-${contractId}`
     */
    static async accrueFee(propertyId, amount, contractId, block) {
      const db = await dbInstance.getDatabase('feeCache');
      const isSpot = (contractId === null || contractId === undefined);
      const effectiveContractId = isSpot ? '1' : String(contractId);
      const cacheId = `${propertyId}-${effectiveContractId}`;
      const row = await TallyMap.loadFeeRow(db, cacheId);

      const amtBN = new BigNumber(amount).decimalPlaces(8);
      if (amtBN.lte(0)) return; // accrual must be > 0

      const blk = await TallyMap.resolveBlock(block);

      if (isSpot) {
        // 50/50 split in integer sats
        const feeSats = toSats(amtBN);
        const insuranceSats = feeSats.idiv(2);
        const valueSats = feeSats.minus(insuranceSats);
        const insuranceAmt = fromSats(insuranceSats);
        const valueAmt = fromSats(valueSats);

        try {
          const insurance = await Insurance.getInstance('1', false);
          await insurance.deposit('1', insuranceAmt.toNumber(), blk);
        } catch (e) {
          console.error('❌ Spot fee insurance deposit failed:', e);
        }

        await TallyMap.saveFeeRow(db, cacheId, {
          value: row.value.plus(valueAmt),
          stash: row.stash,
          contract: '1',
        });
        return;
      }

      // Contract path
      const isNative = await ContractRegistry.isNativeContract(effectiveContractId).catch(() => false);

      if (!isNative) {
        // ORACLE: half to insurance now, exact remainder to STASH
        const feeSats = toSats(amtBN);
        const insuranceSats = feeSats.idiv(2);
        const stashSats = feeSats.minus(insuranceSats);
        const insuranceAmt = fromSats(insuranceSats);
        const stashAmt = fromSats(stashSats);

        try {
          const insurance = await Insurance.getInstance(effectiveContractId, true);
          await insurance.deposit(propertyId, insuranceAmt.toNumber(), blk);
        } catch (e) {
          console.error(`❌ Insurance deposit failed for contract ${effectiveContractId}:`, e);
        }

        await TallyMap.saveFeeRow(db, cacheId, {
          value: row.value,                 // value stays for native-only
          stash: row.stash.plus(stashAmt),  // stash grows until clearing consumes it
          contract: effectiveContractId,
        });
        return;
      }

      // NATIVE: 100% to VALUE
      await TallyMap.saveFeeRow(db, cacheId, {
        value: row.value.plus(amtBN),
        stash: row.stash,
        contract: effectiveContractId,
      });
    }

    /**
     * NEW: adjustFeeCache(propertyId, contractId, { valueDelta?, stashDelta? })
     * - Used by clearing to spend from VALUE/STASH when matching.
     */
    static async adjustFeeCache(propertyId, contractId, deltas) {
      const db = await dbInstance.getDatabase('feeCache');
      const effectiveContractId = (contractId === null || contractId === undefined) ? '1' : String(contractId);
      const cacheId = `${propertyId}-${effectiveContractId}`;
      const row = await TallyMap.loadFeeRow(db, cacheId);

      const valueDelta = new BigNumber(deltas?.valueDelta || 0).decimalPlaces(8);
      const stashDelta = new BigNumber(deltas?.stashDelta || 0).decimalPlaces(8);

      await TallyMap.saveFeeRow(db, cacheId, {
        value: row.value.plus(valueDelta),
        stash: row.stash.plus(stashDelta),
        contract: effectiveContractId,
      });
    }

    /**
     * BACK-COMPAT WRAPPER: updateFeeCache(propertyId, amount, contractId, stash?, spendStash?, block?)
     * - DEPRECATED flags: `stash`, `spendStash` are ignored except to route to adjust.
     * - If `amount > 0` and no flags → accrual
     * - If `amount < 0` and no flags → consume VALUE by `amount`
     * - If `stash==true && spendStash==true` → consume STASH by `amount` (clearing should call adjustFeeCache instead)
     * - If `stash==true && !spendStash` → move VALUE→STASH by `amount` (prefer adjustFeeCache)
     */   
    static async updateFeeCache(propertyId, amount, contractId /* legacy flags ignored */, _a, _b) {
      try {
        const block = arguments.length >= 6 ? arguments[5] : undefined;

        const amtBN = new BigNumber(amount).decimalPlaces(8);
        if (!amtBN.isFinite() || amtBN.lte(0)) {
          // accrual-only; negatives/zeros ignored in this refactor
          return;
        }

        const db = await dbInstance.getDatabase('feeCache');

        // SPOT or native property-1 revenue path
        const isSpotOrOne = (contractId === null || contractId === undefined || String(contractId) === '1');
        if (isSpotOrOne) {
          const cacheId = `${propertyId}-1`;
          const row = await TallyMap.loadFeeRow(db, cacheId);
          // everything goes to STASH
          await TallyMap.saveFeeRow(db, cacheId, { stash: row.stash.plus(amtBN), contract: '1' });
          return;
        }

        // CONTRACT path (non-1): split sats-exact → half insurance NOW, half to STASH
        const effectiveContractId = String(contractId);
        const feeSats = toSats(amtBN);
        const insuranceSats = feeSats.idiv(2);
        const stashSats = feeSats.minus(insuranceSats);
        const insuranceAmt = fromSats(insuranceSats);
        const stashAmt = fromSats(stashSats);

        // 1) deposit half to this contract's insurance now
        const blk = await TallyMap.resolveBlock(block);
        try {
          const isOracle = true; // non-1 contracts here are per your model oracle/derivs; set true to use oracle flavor
          const insurance = await Insurance.getInstance(effectiveContractId, isOracle);
          await insurance.deposit(propertyId, insuranceAmt.toNumber(), blk);
        } catch (e) {
          console.error(`❌ Insurance deposit failed for contract ${effectiveContractId}:`, e);
          // optional: accumulate a 'pendingInsurance' side-cache if you want to recover later
        }

        // 2) stash the remainder for buybacks later
        const cacheId = `${propertyId}-${effectiveContractId}`;
        const row = await TallyMap.loadFeeRow(db, cacheId);
        await TallyMap.saveFeeRow(db, cacheId, { stash: row.stash.plus(stashAmt), contract: effectiveContractId });
      } catch (e) {
        console.error('🚨 Error in updateFeeCache:', e);
      }
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
    static async recordTallyMapDelta(address, block, propertyId, total, availableChange, reservedChange, marginChange, vestingChange, channelChange, type,txid){
        const newUuid = uuid.v4();
        const db = await dbInstance.getDatabase('tallyMapDelta');
        let deltaKey = `${address}-${propertyId}-${newUuid}`;
        deltaKey+='-'+block
        const tally = TallyMap.getTally(address, propertyId)
        if(!txid){txid=''}
        total = tally.available+tally.reserved+tally.margin+tally.channel+tally.vesting
        const delta = { address, block, property: propertyId, total: total, avail: availableChange, res: reservedChange, mar: marginChange, vest: vestingChange, channel: channelChange, type, tx: txid };
        
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
            TallyMap.setModFlag(true)

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
    async saveBlockDelta(blockHeight, blockDelta) {
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
        //console.log('inside getTally '+propertyId+' '+JSON.stringify(addressObj))
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

            console.log('return obj '+address+' '+JSON.stringify(returnObj))

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
