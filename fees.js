const { dbFactory } = require('./db.js')
const { propertyList } = require('./property.js')

class Fees {

    constructor(db) {
        this.fees = new Map()
        this.db = db;
    }

    async save() {
        try {
            for (let [propertyId, feeAmount] of this.fees.entries()) {
                const serializedFeeAmount = JSON.stringify(feeAmount)
                await this.db.updateAsync(
                    { _id: 'feeCache-' + propertyId },
                    { _id: 'feeCache-' + propertyId, value: serializedFeeAmount },
                    { upsert: true }
                )
            }
            console.log('FeeCache saved successfully.')
        } catch (error) {
            console.error('Error saving FeeCache:', error)
        }
    }

    async load() {
        try {
            const m = new Map()
            let keys = await propertyList.getProperties().map(p => p.id)
            for (const k of keys) {
                const result = await this.db.findOneAsync(`{ _id: 'feeCache-${k}' }`)
                if (result?.value) {
                    const f = JSON.parse(result.value)
                    m.set(k, f)
                }
            }
            this.fees = m
            console.log('FeeCache loaded successfully.')
        } catch (error) {
            console.error('Error loading fee cache:', error)
        }
    }

    async update(propertyId, feeAmount) {
        if (!this.fees.has(propertyId)) {
            this.fees.set(propertyId, 0)
        }
        const currentFee = this.fees.get(propertyId)
        this.fees.set(propertyId, currentFee + feeAmount)

        // Optionally, persist fee cache changes to database if necessary
        await this.save()
    }

    async draw(propertyId) {
        if (!this.fees.has(propertyId)) {
            console.log(`No fee cache available for property ID ${propertyId}`)
            return;
        }

        const feeAmount = this.fees.get(propertyId)
        if (feeAmount <= 0) {
            console.log(`Insufficient fee cache for property ID ${propertyId}`)
            return;
        }

        // Logic to match with standing sell orders of property ID 1
        // Adjust this logic based on how you handle order matching
        // ...

        // Deduct the matched amount from the fee cache
        this.fees.set(propertyId, this.fees.get(propertyId) - matchedAmount)

        // Insert the purchased property ID 1 units into the insurance fund
        // Adjust this logic to match your insurance fund implementation
        // ...

        // Save the updated fee cache to the database
        await this.save()
    }
}

let fees
(async () => {
    fees = new Fees(dbFactory.getDatabase('feeCache'))
    await fees.load()
})()

exports.tlFees = fees
