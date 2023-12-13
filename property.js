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

    async load() {
       let propertyIndexEntry
       console.log('loading property list')
        try {
            const propertyIndexEntry = await new Promise((resolve, reject) => {

                db.getDatabase('propertyList').findOne({ _id: 'propertyIndex' }, (err, doc) => {
                    if (err) reject(err);
                    else resolve(doc);
                });
            });

            if (propertyIndexEntry && propertyIndexEntry.value) {
                this.propertyIndex = new Map(JSON.parse(propertyIndexEntry.value));
            }
        } catch (error) {
            console.error('Error loading data from NeDB:', error);
        }
    }

    async getNextPropertyId() {
        await this.load();
        let maxId = 0;
        for (let key of this.propertyIndex.keys()) {
            maxId = Math.max(maxId, key);
        }
        return maxId + 1;
    }

    async createToken(ticker, totalInCirculation, type) {
        // Check if the ticker already exists
        for (let [key, value] of this.propertyIndex.entries()) {
            if (value.ticker === ticker) {
                return Error(`Ticker "${ticker}" already exists.`);
            }
        }

        const propertyId = await this.getNextPropertyId();
        await this.addProperty(propertyId, ticker, totalInCirculation, type);
        console.log(`Token created: ID = ${propertyId}, Ticker = ${ticker}, Type = ${type}`);
        return propertyId;
      }

    async addProperty(propertyId, ticker, totalInCirculation, type) {
        await this.load();
        
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
            feeAmount: 0,
            insuranceAmount: 0,
            reserveAmount: 0,
            marginAmount: 0,
            vestingAmount: 0
        });

        await this.save();
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

    async getPropertyIndex() {
        await this.load();
        return [...this.propertyIndex.entries()];
    }

    // ... other methods like verifyIfManaged, updateAdmin ...
}

module.exports = PropertyManager;
