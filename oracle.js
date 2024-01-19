const { dbFactory } = require('./db.js')

class OracleList {

    constructor(db) {
        this.db = db
        this.oracles = new Map()
    }

    async load() {
        try {
            const oracles = await this.db.findAsync({})
            this.oracles = new Map(oracles.map(o => [o._id, o]))
            console.log('Loaded oracles: ' + [...this.oracles.keys()])
        } catch (error) {
            console.error('Error loading oracles from the database:', error)
        }
    }

    async getAll() {
        return [...this.oracles.values()]
    }

    async createOracle(data) {
        try {
            const oracleId = this.getNextId()
            await this.db.insertAsync({ _id: oracleId, ...data })
            this.oracles.set(oracleId, data)

            console.log(`New oracle created: ID ${oracleId}, Name: ${JSON.stringify(data)}`)
            return oracleId
        } catch (error) {
            console.error('Error creating new oracle:', error)
            throw error
        }
    }

    async getOracle(oracleId) {
        if (!Number.isInteger(oracleId)) {
            console.log(`Invalid oracle ID: ${oracleId}`)
            return null
        }

        let oracle = this.oracles.get(oracleId)
        if (!oracle) {
            oracle = await this.db.findOneAsync({ _id: oracleId })
        }
        if (!oracle) {
            console.log(`Oracle data not found for oracle ID: ${oracleId}`)
            return null
        }
        return oracle
    }

    async verifyAdmin(oracleId, adminAddress) {
        let oracle = this.getOracle(oracleId)
        return oracle?.adminAddress === adminAddress;
    }

    async updateAdmin(oracleId, newAdminAddress) {
        let oracle = this.getOracle(oracleId)
        if (!oracle) {
            throw new Error(`Oracle not found: id:${oracleId}`)
        }
        oracle.adminAddress = newAdminAddress;

        await this.db.updateAsync({ _id: oracleId }, { $set: { adminAddress: newAdminAddress } }, {})
        this.oracles.set(oracleId, oracle)
        console.log(`Oracle ID ${oracleId} admin updated to ${newAdminAddress}`)
    }

    getNextId() {
        let maxId = Math.max(0, ...this.oracles.keys())
        return (Number.isInteger(maxId) ? maxId : 0) + 1
    }

    async setOracleData(oracleId, data, blockHeight) {
        const key = `oracle-${oracleId}-${blockHeight}`
        const entry = {
            _id: key,
            oracleId,
            data,
            blockHeight
        }

        try {
            await dbFactory.getDatabase('oracleData').updateAsync(
                { _id: key },
                entry,
                { upsert: true }
            )
            console.log(`Oracle data record saved successfully: ${key}`)
        } catch (error) {
            console.error(`Error saving oracle data record: ${key}`, error)
            throw error
        }
    }

    async getOracleData(oracleId, startBlockHeight = 0, endBlockHeight = Number.MAX_SAFE_INTEGER) {
        try {
            const data = await dbFactory.getDatabase('oracleData').findAsync({
                oracleId: oracleId,
                blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
            })
            return data.map(record => ({
                blockHeight: record.blockHeight,
                data: record.data
            }))
        } catch (error) {
            console.error(`Error loading oracle data for oracleId:${oracleId}:`, error)
            throw error
        }
    }

    getTwap(contractId) {
        // Logic to fetch TWAP data for the given contractId
        // Example:
        // return await someExternalOracleService.getTwap(contractId)
    }
}

let list
(async () => {
    list = new OracleList(dbFactory.getDatabase('oracleList'))
    await list.load()
})()

exports.oracleList = list
