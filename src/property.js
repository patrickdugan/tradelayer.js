const db = require('./db.js');
const path = require('path');
const BigNumber = require('bignumber.js')

class PropertyManager {
    static instance = null;

    constructor() {
        if (PropertyManager.instance) {
            return PropertyManager.instance;
        }

        this.propertyIndex = new Map();
        this.ammIndex = new Map(); // Initialize AMM index
        //this.synthIndex= new Map()
        PropertyManager.instance = this;
    }

    static getInstance() {
        if (!PropertyManager.instance) {
            PropertyManager.instance = new PropertyManager();
        }
        return PropertyManager.instance;
    }

    static async load() {
        //console.log('loading property list');
        try {
            const instance = PropertyManager.getInstance();
            const base = await db.getDatabase('propertyList')
            const propertyIndexEntry = await base.findOneAsync({ _id: 'propertyIndex' });
            if (propertyIndexEntry && propertyIndexEntry.value) {
                // Check if the value is a string and parse it as JSON
                const data = typeof propertyIndexEntry.value === 'string' ? JSON.parse(propertyIndexEntry.value) : propertyIndexEntry.value;

                // Ensure the data is an array of arrays before converting it to a Map
                if (Array.isArray(data) && data.every(item => Array.isArray(item) && item.length === 2)) {
                    instance.propertyIndex = new Map(data);
                } else {
                    console.error('Invalid data format for propertyIndex:', data);
                    instance.propertyIndex = new Map();
                }
            } else {
                instance.propertyIndex = new Map(); // Initialize with an empty Map if no data is found
            }
        } catch (error) {
            console.error('Error loading data from NeDB:', error);
            //instance.propertyIndex = new Map(); // Use an empty Map in case of an error
        }
    }


    async getNextPropertyId() {
        await PropertyManager.load();
        let maxId = 0;
        for (let key of this.propertyIndex.keys()) {
            maxId = Math.max(maxId, key);
        }
        return maxId + 1;
    }

    async createToken(ticker, totalInCirculation, type, whitelistId, issuer, backupAddress) {
        // Check if the ticker already exists

        if (this.propertyIndex.has(ticker)) {
            return new (`Error: Ticker "${ticker}" already exists.`);
        }
        for (let [key, value] of this.propertyIndex.entries()) {
            if (value.ticker === ticker) {
                return Error(`Ticker "${ticker}" already exists.`);
            }
        }

        const propertyId = await this.getNextPropertyId();
        await this.addProperty(propertyId, ticker, totalInCirculation, type, whitelistId, issuer, backupAddress);
        console.log(`Token created: ID = ${propertyId}, Ticker = ${ticker}, Type = ${type}`);
        return propertyId;
      }

    async addProperty(propertyId, ticker, totalInCirculation, type, whitelistId, issuer, backupAddress) {
        
        const propertyTypeIndexes = {
            'Fixed': 1,
            'Managed': 2,
            'Native': 3,
            'Vesting': 4,
            'Synthetic': 5,
            'Non-Fungible': 6,
        };

        if (!propertyTypeIndexes[type]) {
            throw new Error('Invalid property type.');
        }

        let existingProperty = this.propertyIndex.get(propertyId);

        if(type=="Synthetic"){
            console.log('creating synth property '+propertyId+' '+totalInCirculation+' '+existingProperty)
            // Retrieve existing property entry if it exists
        }

        if (existingProperty) {
            // If property exists, update totalInCirculation and other fields if necessary
            existingProperty.totalInCirculation = BigNumber(existingProperty.totalInCirculation).plus(totalInCirculation).toNumber();
            existingProperty.ticker = ticker || existingProperty.ticker;
            existingProperty.type = propertyTypeIndexes[type];
            existingProperty.whitelistId = whitelistId || existingProperty.whitelistId;
            existingProperty.issuer = issuer || existingProperty.issuer;
            existingProperty.backupAddress = backupAddress || existingProperty.backupAddress;
        } else {
            // If property does not exist, create a new one
            existingProperty = {
                ticker,
                totalInCirculation,
                type: propertyTypeIndexes[type],
                whitelistId: whitelistId,
                issuer: issuer,
                backupAddress: backupAddress
            };
        }

        let blob =  {
            ticker,
            totalInCirculation,
            type: propertyTypeIndexes[type],
            whitelistId: whitelistId,
            issuer: issuer,
            backupAddress: backupAddress
        }

        this.propertyIndex.set(propertyId,existingProperty);
        await this.save();
        return console.log('updated Property Index '+this.propertyIndex)
    }

    async inspectPropertyIndex() {
        const propertyManager = PropertyManager.getInstance();

        // Load the properties
        await PropertyManager.load();

        // Convert the Map into an array of key-value pairs
        const propertiesArray = Array.from(propertyManager.propertyIndex.entries());

        // Alternatively, convert the Map into an object for easier visualization
        const propertiesObject = Object.fromEntries(propertyManager.propertyIndex);

        console.log('Properties as Array:', propertiesArray);
        console.log('Properties as Object:', propertiesObject);
    }

    static async getAMM(propertyId1, propertyId2) {
        const pairKey = `${propertyId1}-${propertyId2}`;
        const ammInstance = PropertyRegistry.getInstance().ammIndex.get(pairKey);

        if (ammInstance) {
            return ammInstance;
        } else {
            // If AMM instance doesn't exist, initialize it
            const newAMM = await initializeAMM(propertyId1, propertyId2); // You need to define the initialization logic
            PropertyRegistry.getInstance().ammIndex.set(pairKey, newAMM);
            return newAMM;
        }
    }

    static async updateTotalInCirculation(propertyId, amountChange) {
        const propertyData = await PropertyManager.getPropertyData(propertyId);

        if (!propertyData) {
            throw new Error('Property not found');
        }

        propertyData.totalInCirculation = BigNumber(propertyData.totalInCirculation).plus(amountChange).toNumber();

        // Update the property data in the database
        const base= await db.getDatabase('propertyList')
        const propertyIndex = await base.findOneAsync({ _id: 'propertyIndex' });
        const parsedData = JSON.parse(propertyIndex.value);

        const propertyEntry = parsedData.find(entry => entry[0] === propertyId);
        if (propertyEntry) {
            propertyEntry[1] = propertyData;
            await db.getDatabase('propertyList').updateAsync({ _id: 'propertyIndex' }, { $set: { value: JSON.stringify(parsedData) } });
        } else {
            throw new Error('Failed to update totalInCirculation, property not found in index');
        }
    }


    async save() {

        const propertyIndexJSON = JSON.stringify([...this.propertyIndex.entries()]);
        const propertyIndexData = { _id: 'propertyIndex', value: propertyIndexJSON };

        await new Promise((resolve, reject) => {
            db.getDatabase('propertyList').update({ _id: 'propertyIndex' }, propertyIndexData, { upsert: true }, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    }

     

    static async getPropertyIndex() {
        const instance = PropertyManager.getInstance();

        // If the propertyIndex is empty, load it first
        if (instance.propertyIndex.size === 0) {
            await PropertyManager.load();
        }
        
        // Transform the Map into an array of objects, each representing a property
        return Array.from(instance.propertyIndex).map(([id, property]) => ({
            id,
            ticker: property.ticker,
            totalInCirculation: property.totalInCirculation,
            type: property.type
        }));
    }


    /**
     * Checks if the given ticker already exists in the property index.
     * @param {string} ticker - The ticker to check for existence.
     * @returns {boolean} - True if the ticker exists, false otherwise.
     */
    static async doesTickerExist(ticker) {
        // Ensure the property index is loaded before checking
        const base = await db.getDatabase('propertyList')
        const index = await base.findOneAsync({ _id: 'propertyIndex' });
        
        if(!index){
            return false
        }
        // Parse the JSON string to get the actual array
        const parsedIndex = JSON.parse(index.value);
        
        // Iterate over the parsed array to check for the ticker
        for (let [propertyId, propertyData] of parsedIndex) {
            if (propertyData.ticker === ticker) {
                return true;
            }
        }
        return false;
    }


     /**
     * Checks if the given propertyId is a synthetic token.
     * @param {number} propertyId - The ID of the property to check.
     * @returns {boolean} - True if the property is a synthetic token, false otherwise.
     */
    static async isSyntheticToken(propertyId) {
        if(!this.propertyIndex){await this.load();}  // Make sure the property list is loaded
        const propertyInfo = this.propertyIndex.get(propertyId);
        // Check if the propertyInfo is valid and the type is 5 (synthetic)
        return propertyInfo && propertyInfo.type === 5;
    }

    async grantTokens(propertyId, recipient, amount,block) {
        const propertyData = await this.getPropertyData(propertyId);
        if (!propertyData) {
            throw new Error(`Property with ID ${propertyId} not found.`);
        }

        // Update managed supply
        propertyData.totalInCirculation += amount;

        // Update tally map to credit the amount to recipient
        await TallyMap.updateBalance(recipient, propertyId, amount,0,0,0,'grantToken',block);

        // Save changes
        await this.save();
        console.log(`Granted ${amount} managed tokens to ${recipient} for property ${propertyId}.`);
    }

    async redeemTokens(propertyId, recipient, amount,block) {
        const propertyData = await this.getPropertyData(propertyId);
        if (!propertyData) {
            throw new Error(`Property with ID ${propertyId} not found.`);
        }

        // Ensure enough managed tokens available for redemption
        if (propertyData.totalInCirculation < amount) {
            throw new Error(`Insufficient managed tokens for redemption for property ${propertyId}.`);
        }

        // Update managed supply
        propertyData.totalInCirculation -= amount;

        // Update tally map to debit the amount from recipient
        await TallyMap.updateBalance(recipient, propertyId, -amount,0,0,0,'redeemToken',block);

        // Save changes
        await this.save();
        console.log(`Redeemed ${amount} managed tokens from ${recipient} for property ${propertyId}.`);
    }


   static async getPropertyData(propertyId) {
        try {
            const base = await db.getDatabase('propertyList')
            const propertyData = base.findOneAsync({ _id: 'propertyIndex' });

            if (propertyData && propertyData.value) {
                const parsedData = JSON.parse(propertyData.value);
                //console.log(propertyId)
                // Check if propertyId is a synthetic ID
                if (typeof propertyId === 'string' && propertyId.startsWith('s')) {
                    console.log('inside get property synthetic '+propertyId)
                    const syntheticEntry = parsedData.find(entry => entry[0] === propertyId);
                    console.log(JSON.stringify(syntheticEntry))
                    if (syntheticEntry) {
                        return syntheticEntry[1];
                    }/* else {
                        // Optionally, look for the synthetic ID in a separate registry
                        const syntheticData = await db.getDatabase('syntheticTokens').findOneAsync({ _id: propertyId });
                        return syntheticData ? JSON.parse(syntheticData.value) : null;
                    }*/
                }

                // Check for integer-based property ID
                //console.log('propertyId:', propertyId, 'type:', typeof propertyId);
                const propertyEntry = parsedData.find(entry => Number(entry[0]) === Number(propertyId));
                //console.log('retrieving property data '+JSON.stringify(propertyEntry)+' '+JSON.stringify(parsedData))
                if (propertyEntry) {
                    return propertyEntry[1];
                } else {
                    return null;
                }
            } else {
                return null; // Return null if no property data found in the database
            }
        } catch (error) {
            console.error('Error fetching property data:', error);
            return null; // Return null in case of any errors
        }
    }


    static async updateAdmin(propertyId, newAddress, backup) {
        try {
            // Ensure the property index is loaded
            await PropertyManager.load();

            // Check if the property exists
            if (!PropertyManager.instance.propertyIndex.has(propertyId)) {
                throw new Error(`Property with ID ${propertyId} does not exist.`);
            }

            // Get the property data
            const propertyData = await getPropertyData(propertyId);

            if(backup){
                properData.backupAddress=newAddress
            }else{
                 // Update the admin address
                propertyData.issuer = newAddress; 
            }

            // Update the property index with the modified property data
            this.propertyIndex.set(propertyId, propertyData);

            await this.save();

            console.log(`Admin address for property ID ${propertyId} updated to ${newAddress}.`);
        } catch (error) {
            console.error(`Error updating admin address for property ID ${propertyId}:`, error);
            throw error;
        }
    }


    // ... other methods like verifyIfManaged, updateAdmin ...
}

module.exports = PropertyManager;
