const { Level } = require('level')
var db = require('./db')

class PropertyManager {
    static instance = null;

    constructor() {
        if (!PropertyManager.instance) {
            this.propertyIndex = new Map();
            this.nextPropertyId = 1;
            PropertyManager.instance = this;
        }
        return PropertyManager.instance;
    }

    static getInstance() {
        if (!PropertyManager.instance) {
            PropertyManager.instance = new PropertyManager();
        }
        return PropertyManager.instance;
    }

    static async load() {
        try {
            const propertyIndexEntry = await new Promise((resolve, reject) => {
                db.getDatabase('propertyList').findOne({ _id: 'propertyIndex' }, (err, doc) => {
                    if (err) reject(err);
                    else resolve(doc);
                });
            });

            const nextPropertyIdEntry = await new Promise((resolve, reject) => {
                db.getDatabase('propertyList').findOne({ _id: 'nextPropertyId' }, (err, doc) => {
                    if (err) reject(err);
                    else resolve(doc);
                });
            });

            if (propertyIndexEntry) {
                this.propertyIndex = new Map(JSON.parse(propertyIndexEntry.value));
            } else {
                this.propertyIndex = new Map();
            }

            if (nextPropertyIdEntry) {
                this.nextPropertyId = parseInt(nextPropertyIdEntry.value, 10);
            } else {
                this.nextPropertyId = 1;
            }

        } catch (error) {
            console.error('Error loading data from NeDB:', error);
            this.propertyIndex = new Map();
            this.nextPropertyId = 1;
        }
    }


    static getNextPropertyId() {
        return this.nextPropertyId++;
    }

    static createToken(ticker, totalInCirculation, type) {
        // Get the next available property ID
        const propertyId = this.getNextPropertyId();

        // Add the new token to the property index
        this.addProperty(propertyId, ticker, totalInCirculation, type);

        // Optionally, immediately save the updated state
        this.save();

        console.log(`Token created: ID = ${propertyId}, Ticker = ${ticker}, Type = ${type}`);
        return propertyId; // Return the new token's property ID
    }

    static async addProperty(propertyId, ticker, totalInCirculation, type) {
        if (this.propertyIndex.has(propertyId)) {
            throw new Error('Property ID already exists.');
        }

        const propertyTypeIndexes = {
            Fixed: 1,
            Managed: 2,
            Native: 3,
            Vesting: 4,
            Synthetic: 5,
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

        await this.save()
    }

    static isPropertyIdValid(propertyId) {
        return this.propertyIndex.has(propertyId);
    }

    static getPropertyData(propertyId) {
        if (!this.isPropertyIdValid(propertyId)) {
            return null;
        }
        return this.propertyIndex.get(propertyId);
    }

    static async getPropertyIndex() {
        await this.load()
        const propertyIndexJSON = {};
        this.propertyIndex.forEach((value, key) => {
            propertyIndexJSON[key] = {
                ticker: value.ticker,
                totalInCirculation: value.totalInCirculation,
                type: value.type,
                feeAmount: value.feeAmount,
                insuranceAmount: value.insuranceAmount,
                reserveAmount: value.reserveAmount,
                marginAmount: value.marginAmount,
            };
        });
        return propertyIndexJSON;
    }

    static async save() {
      const propertyIndexJSON = JSON.stringify([...this.propertyIndex.entries()]);
      const nextPropertyIdData = { _id: 'nextPropertyId', value: this.nextPropertyId.toString() };
      const propertyIndexData = { _id: 'propertyIndex', value: propertyIndexJSON };

      await db.getDatabase('propertyList').update({ _id: 'nextPropertyId' }, nextPropertyIdData, { upsert: true });
      await db.getDatabase('propertyList').update({ _id: 'propertyIndex' }, propertyIndexData, { upsert: true });
    }

    static async verifyIfManaged(propertyId) {
        const property = this.getPropertyData(propertyId);
        if (!property) {
            throw new Error('Property not found');
        }
        return property.type === 'Managed';
    }

    static async updateAdmin(propertyId, newAdminAddress) {
        const property = this.getPropertyData(propertyId);
        if (!property) {
            throw new Error('Property not found');
        }
        if (property.type !== 'Managed') {
            throw new Error('Only managed properties can have an admin');
        }

        property.adminAddress = newAdminAddress;
        this.propertyIndex.set(propertyId, property);
        await this.save();

        console.log(`Admin for property ${propertyId} updated to ${newAdminAddress}`);
    }
}

module.exports = PropertyManager;
