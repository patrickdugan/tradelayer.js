const { dbFactory } = require('./db.js')

class PropertyManager {

    constructor(db) {
        this.db = db;
        this.properties = new Map()
    }

    async load() {
        try {
            const entry = await this.db.findOneAsync({ _id: 'propertyIndex' })
            if (entry?.value) {
                // Check if the value is a string and parse it as JSON
                const data = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;

                // Ensure the data is an array of arrays before converting it to a Map
                if (Array.isArray(data) && data.every(item => Array.isArray(item) && item.length === 2)) {
                    this.properties = new Map(data)
                } else {
                    console.error('Invalid data format for propertyIndex:', data)
                    this.properties = new Map()
                }
            }
        } catch (error) {
            console.error('Error loading data from NeDB:', error)
            //this.properties = new Map() // Use an empty Map in case of an error
        }
        console.log('Loaded properties')
    }

    async save() {
        const json = JSON.stringify([...this.properties.entries()])
        await this.db.updateAsync({ _id: 'propertyIndex' }, { _id: 'propertyIndex', value: json }, { upsert: true })
        console.log('Updated propertties:' + this.properties)
    }

    clear() {
        this.db.remove({}, { multi: true })
    }

    async createToken(ticker, totalInCirculation, type, whitelistId, backupAddress) {
        // Check if the ticker already exists
        if (this.properties.has(ticker)) {
            return new (`Error: Ticker "${ticker}" already exists.`)
        }
        for (let [key, value] of this.properties.entries()) {
            if (value.ticker === ticker) {
                return Error(`Ticker "${ticker}" already exists.`)
            }
        }

        const propertyId = this.getNextId()
        await this.addProperty(propertyId, ticker, totalInCirculation, type, whitelistId, backupAddress)
        console.log(`Token created: ID = ${propertyId}, Ticker = ${ticker}, Type = ${type}`)
        return propertyId;
    }

    async addProperty(propertyId, ticker, totalInCirculation, type, whitelistId, backupAddress) {
        const cats = {
            'Fixed': 1,
            'Managed': 2,
            'Native': 3,
            'Vesting': 4,
            'Synthetic': 5,
            'Non-Fungible': 6,
        };

        if (!cats[type]) {
            throw new Error('Invalid property type.')
        }

        this.properties.set(propertyId, {
            ticker,
            totalInCirculation,
            type: cats[type],
            whitelistId: whitelistId,
            backupAddress: backupAddress
        })

        await this.save()
    }

    dump() {
        console.log('Properties:', this.getProperties())
    }

    getNextId() {
        let maxId = Math.max(0,...this.properties.keys())
        return (Number.isInteger(maxId) ? maxId : 0) + 1
    }

    getProperty(propertyId) {
        return this.properties.get(propertyId)
    }

    getProperties() {
        return Array.from(this.properties).map(([id, property]) => ({
            id,
            ticker: property.ticker,
            totalInCirculation: property.totalInCirculation,
            type: property.type
        }))
    }

    isManagedProperty(propertyId) {
        let p = this.getProperty(propertyId)
        return p?.type === 2
    }

    /**
    * Checks if the given propertyId is a synthetic token.
    * @param {number} propertyId - The ID of the property to check.
    * @returns {boolean} - True if the property is a synthetic token (5), false otherwise.
    */
    isSyntheticToken(propertyId) {
        const p = this.getProperty(propertyId)
        return p?.type === 5;
    }
}

let list
(async () => {
    list = new PropertyManager(dbFactory.getDatabase('propertyList'))
    await list.load()
})()

exports.propertyList = list
