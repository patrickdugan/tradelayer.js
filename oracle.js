const { dbFactory } = require('./db.js')

class OracleList {

    constructor(db) {
        this.db = db
        this.oracles = new Map()
    }

    async load() {
        try {
            const oracles = await this.db.getDatabase('oracleList').findAsync({})
            this.oracles = new Map(oracles.map(o => [o._id, o]))
            console.log('Loaded oracles: '+[...this.oracles.values()].map(v=>v.id))
        } catch (error) {
            console.error('Error loading oracles from the database:', error)
        }
    }

    async getAll() {
        // Convert the Map of oracles to an array
        return Array.from(this.oracles.values())
    }

    async addOracle(oracleId, oracleData) {
        try {
            // Add to in-memory map
            this.oracles.set(oracleId, oracleData)

            // Add to NeDB database (if applicable)
            const odb = this.db.getDatabase('oracleList')
            await odb.insertAsync({ _id: oracleId, ...oracleData })

            console.log(`Oracle added: ID ${oracleId}`)
        } catch (error) {
            console.error(`Error adding oracle: ID ${oracleId}`, error)
            throw error; // Re-throw the error for the caller to handle
        }
    }

    async getOracle(oracleId) {
        // Oracle key to search for
        const oracleKey = `oracle-${oracleId}`;

        // Check in the in-memory map
        let oracle = this.oracles.get(oracleKey)
        if (oracle) {
            return oracle;
        }

        // If not found in-memory, optionally check the database
        const odb = this.db.getDatabase('oracleList')
        oracle = await odb.findOneAsync({ _id: oracleKey })
        if (oracle) {
            return oracle;
        }

        console.log(`Oracle data not found for oracle ID: ${oracleId}`)

        return null;
    }

    async verifyAdmin(oracleId, adminAddress) {
        const oracleKey = `oracle-${oracleId}`;
        // Check in-memory map first
        let oracle = this.oracles.get(oracleKey)

        // If not found in-memory, check the database
        if (!oracle) {
            const odb = this.db.getDatabase('oracleList')
            oracle = await odb.findOneAsync({ _id: oracleKey })
        }

        // Verify admin address
        return oracle && oracle.adminAddress === adminAddress;
    }


    async updateAdmin(oracleId, newAdminAddress) {
        const oracleKey = `oracle-${oracleId}`;

        // Get the NeDB datastore for oracles
        const odb = this.db.getDatabase('oracleList')

        // Fetch the current oracle data
        const oracle = await odb.findOneAsync({ _id: oracleKey })

        if (!oracle) {
            throw new Error('Oracle not found')
        }

        // Update the admin address
        oracle.adminAddress = newAdminAddress;

        // Update the oracle in the database
        await odb.updateAsync({ _id: oracleKey }, { $set: { adminAddress: newAdminAddress } }, {})

        // Optionally, update the in-memory map if you are maintaining one
        this.oracles.set(oracleKey, oracle)

        console.log(`Oracle ID ${oracleId} admin updated to ${newAdminAddress}`)
    }

    async createOracle(name, adminAddress) {
        const oracleId = this.getNextId()
        const oracleKey = `oracle-${oracleId}`;

        const newOracle = {
            _id: oracleKey, // NeDB uses _id as the primary key
            id: oracleId,
            name: name,
            adminAddress: adminAddress,
            data: {} // Initial data, can be empty or preset values
        };

        try {
            // Save the new oracle to the database
            await this.db.getDatabase('oracleList').insertAsync(newOracle)

            // Also save the new oracle to the in-memory map
            this.oracles.set(oracleKey, newOracle)

            console.log(`New oracle created: ID ${oracleId}, Name: ${name}`)
            return oracleId; // Return the new oracle ID
        } catch (error) {
            console.error('Error creating new oracle:', error)
            throw error; // Re-throw the error for the caller to handle
        }
    }

    getNextId() {
        let nums = [...this.oracles.values()].map(v=>v.id)
        let maxId = Math.max(...nums)
        return (Number.isFinite(maxId) ? maxId : 0) + 1
    }

    async saveOracleData(oracleId, data, blockHeight) {
        const odb = this.db.getDatabase('oracleData')
        const recordKey = `oracle-${oracleId}-${blockHeight}`;

        const oracleDataRecord = {
            _id: recordKey,
            oracleId,
            data,
            blockHeight
        };

        try {
            await odb.updateAsync(
                { _id: recordKey },
                oracleDataRecord,
                { upsert: true }
            )
            console.log(`Oracle data record saved successfully: ${recordKey}`)
        } catch (error) {
            console.error(`Error saving oracle data record: ${recordKey}`, error)
            throw error;
        }
    }

    async loadOracleData(oracleId, startBlockHeight = 0, endBlockHeight = Number.MAX_SAFE_INTEGER) {
        const odb = this.db.getDatabase('oracleData')
        try {
            const query = {
                oracleId: oracleId,
                blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
            };
            const oracleDataRecords = await odb.findAsync(query)
            return oracleDataRecords.map(record => ({
                blockHeight: record.blockHeight,
                data: record.data
            }))
        } catch (error) {
            console.error(`Error loading oracle data for oracleId ${oracleId}:`, error)
            throw error;
        }
    }

    getTwap(contractId) {
        // Logic to fetch TWAP data for the given contractId
        // Example:
        // return await someExternalOracleService.getTwap(contractId)
    }
}

let list
(async() => {
    list = new OracleList(dbFactory)
    await list.load()
})()

exports.oracleList = list
