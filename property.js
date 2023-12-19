const db = require('./db.js');
const path = require('path');

class PropertyManager {
    static instance = null;

    constructor() {
        if (PropertyManager.instance) {
            return PropertyManager.instance;
        }

        this.propertyIndex = new Map();
        PropertyManager.instance = this;
    }

    static getInstance() {
        if (!PropertyManager.instance) {
            PropertyManager.instance = new PropertyManager();
        }
        return PropertyManager.instance;
    }

    static async load() {
        console.log('loading property list');
        try {
            const propertyIndexEntry = await db.getDatabase('propertyList').findOneAsync({ _id: 'propertyIndex' });
            if (propertyIndexEntry && propertyIndexEntry.value) {
                // Check if the value is a string and parse it as JSON
                const data = typeof propertyIndexEntry.value === 'string' ? JSON.parse(propertyIndexEntry.value) : propertyIndexEntry.value;

                // Ensure the data is an array of arrays before converting it to a Map
                if (Array.isArray(data) && data.every(item => Array.isArray(item) && item.length === 2)) {
                    this.propertyIndex = new Map(data);
                } else {
                    console.error('Invalid data format for propertyIndex:', data);
                    this.propertyIndex = new Map();
                }
            } else {
                this.propertyIndex = new Map(); // Initialize with an empty Map if no data is found
            }
        } catch (error) {
            console.error('Error loading data from NeDB:', error);
            this.propertyIndex = new Map(); // Use an empty Map in case of an error
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

    async createToken(ticker, totalInCirculation, type, whitelistId, backupAddress) {
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
        await this.addProperty(propertyId, ticker, totalInCirculation, type, whitelistId, backupAddress);
        console.log(`Token created: ID = ${propertyId}, Ticker = ${ticker}, Type = ${type}`);
        return propertyId;
      }

    async addProperty(propertyId, ticker, totalInCirculation, type, whitelistId, backupAddress) {
        
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

        this.propertyIndex.set(propertyId, {
            ticker,
            totalInCirculation,
            type: propertyTypeIndexes[type],
            whitelistId: whitelistId,
            backupAddress: backupAddress
        });
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

    async save() {

        const propertyIndexJSON = JSON.stringify([...this.propertyIndex.entries()]);
        const propertyIndexData = { _id: 'propertyIndex', value: propertyIndexJSON };

        await new Promise((resolve, reject) => {
            db.getDatabase('propertyList').update({ _id: 'propertyIndex' }, propertyIndexData, { upsert: true }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    getPropertyData(propertyId) {
        return this.propertyIndex.get(propertyId) || null;
    }

    static async getPropertyIndex() {
        await this.load(); // Ensure the property list is loaded
        // Transform the Map into an array of objects, each representing a property
        return Array.from(this.propertyIndex).map(([id, property]) => ({
            id,
            ticker: property.ticker,
            totalInCirculation: property.totalInCirculation,
            type: property.type
        }));
    }
    // ... other methods like verifyIfManaged, updateAdmin ...
}

module.exports = PropertyManager;
