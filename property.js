const { Level } = require('level')

class PropertyManager {
    constructor(dbPath) {
        this.propertyIndex = new Map();
        this.nextPropertyId = 1;
        this.db = new Level(dbPath);
    }

    async load() {
        try {
            const propertyIndexJSON = await this.db.get('propertyIndex');
            this.propertyIndex = new Map(JSON.parse(propertyIndexJSON));
            const nextPropertyIdString = await this.db.get('nextPropertyId');
            this.nextPropertyId = parseInt(nextPropertyIdString, 10);
        } catch (error) {
            if (error.notFound) {
                this.propertyIndex = new Map();
                this.nextPropertyId = 1;
            } else {
                console.error('Error loading data from LevelDB:', error);
            }
        }
    }

    getNextPropertyId() {
        return this.nextPropertyId++;
    }

    createToken(ticker, totalInCirculation, type) {
        // Get the next available property ID
        const propertyId = this.getNextPropertyId();

        // Add the new token to the property index
        this.addProperty(propertyId, ticker, totalInCirculation, type);

        // Optionally, immediately save the updated state
        this.save();

        console.log(`Token created: ID = ${propertyId}, Ticker = ${ticker}, Type = ${type}`);
        return propertyId; // Return the new token's property ID
    }

    addProperty(propertyId, ticker, totalInCirculation, type) {
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
        });
    }

    isPropertyIdValid(propertyId) {
        return this.propertyIndex.has(propertyId);
    }

    getPropertyData(propertyId) {
        if (!this.isPropertyIdValid(propertyId)) {
            return null;
        }
        return this.propertyIndex.get(propertyId);
    }

    getPropertyIndex() {
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

    async save() {
        const propertyIndexJSON = JSON.stringify([...this.propertyIndex]);
        await this.db.put('propertyIndex', propertyIndexJSON);
        await this.db.put('nextPropertyId', this.nextPropertyId.toString());
    }

    async verifyIfManaged(propertyId) {
        const property = this.getPropertyData(propertyId);
        if (!property) {
            throw new Error('Property not found');
        }
        return property.type === 'Managed';
    }

    async updateAdmin(propertyId, newAdminAddress) {
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
    
    async clear() {
        await this.db.clear()
    }

    async close() {
        await this.db.close()
    }
}

module.exports = PropertyManager;
