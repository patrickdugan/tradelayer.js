const { dbFactory } = require('./db.js')

class PropertyManager {
    // pid => {}
    static Empty = {
        ticker: '?',
        totalInCirculation : 0,
        type: '?',
        whitelistId: 0,
        backupAddress: '?'
    }

    constructor(db) {
        this.db = db;
        this.properties = new Map()
    }

    async load() {
        try {
            const entries = await this.db.findAsync({})
            this.properties = new Map(entries.map(e => [e._id, e.value]))
        } catch (error) {
            console.error('Error loading properties: ', error)
        }
        console.log('Loaded properties: '+[...this.properties.keys()])
    }

    async save(pid, property) {
        await this.db.updateAsync({ _id: pid }, { $set: { value: property } }, { upsert: true })
        console.log('Updated properties:' + this.properties)
    }

    clear() {
        this.db.remove({}, { multi: true })
    }
        
    async createToken(ticker, totalInCirculation, type, whitelistId, backupAddress) {
        let entries = [...this.properties.entries()]
        let i = entries.findIndex(([k,v]) => v?.ticker === ticker)
        if (i > -1) {
            let pid = entries[i][0]
            console.log(`Ticker "${ticker}" already exists, pid:${pid}`)
            return pid
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

        if (!Number.isInteger(propertyId) || !cats[type]) {
            throw new Error(`Invalid property: pid:${propertyId}, ticker:ticker}, cat:${cats[type]}`)
        }

        let p = {
            ticker,
            totalInCirculation,
            type: cats[type],
            whitelistId: whitelistId,
            backupAddress: backupAddress
        }
        this.properties.set(propertyId, p)

        await this.save(propertyId, p)
    }

    dump() {
        console.log('Properties: ', this.getProperties())
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

    isSyntheticToken(propertyId) {
        const p = this.getProperty(propertyId)
        return p?.type === 5;
    }

    validateProperties(a1) {
        const a2 = [...this.properties.keys()].filter(v => a1.includes(v))
        return (a1.length == a2.length && a1.every(function(u, i) { return u === a2[i] }))
    }
}

let list
(async () => {
    list = new PropertyManager(dbFactory.getDatabase('propertyList'))
    await list.load()
})()

exports.propertyList = list
