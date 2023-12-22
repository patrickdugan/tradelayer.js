var db = require('./db')

class OracleList {
    constructor() {
        this.oracles = new Map(); // Stores all oracles
    }

    async load() {
        try {
            for await (const [key, value] of this.db.iterator({ gt: 'oracle-', lt: 'oracle-\xFF' })) {
                this.oracles.set(key, JSON.parse(value));
            }
        } catch (error) {
            console.error('Error loading oracles from the database:', error);
        }
    }

    async close() {
        await this.db.close()
    }

    verifyAdmin(oracleId, adminAddress) {
        const oracleKey = `oracle-${oracleId}`;
        const oracle = this.oracles.get(oracleKey);
        return oracle && oracle.adminAddress === adminAddress;
    }

    async updateAdmin(oracleId, newAdminAddress) {
        const oracleKey = `oracle-${oracleId}`;
        const oracle = this.oracles.get(oracleKey);

        if (!oracle) {
            throw new Error('Oracle not found');
        }

        oracle.adminAddress = newAdminAddress;
        await this.db.put(oracleKey, JSON.stringify(oracle));
        this.oracles.set(oracleKey, oracle);

        console.log(`Oracle ID ${oracleId} admin updated to ${newAdminAddress}`);
    }

    async createOracle(name, adminAddress) {
        const oracleId = this.getNextId();
        const oracleKey = `oracle-${oracleId}`;

        const newOracle = {
            id: oracleId,
            name: name,
            adminAddress: adminAddress,
            data: {} // Initial data, can be empty or preset values
        };

        // Save the new oracle to the in-memory map and the database
        this.oracles.set(oracleKey, newOracle);
        await this.db.put(oracleKey, JSON.stringify(newOracle));

        console.log(`New oracle created: ID ${oracleId}, Name: ${name}`);
        return oracleId; // Return the new oracle ID
    }

     static async getOracleData(propertyId) {
        // Assuming each oracle contains data for various properties
        // and that data is stored in a format like: oracle[propertyId]
        for (const oracle of this.oracles.values()) {
            if (oracle[propertyId]) {
                return oracle[propertyId]; // Return the data for the specified propertyId
            }
        }
        console.log(`Property data not found for property ID: ${propertyId}`);
        return null; // Return null if the property data is not found
    }

    getNextId() {
        let maxId = 0;
        for (const key of this.oracles.keys()) {
            const currentId = parseInt(key.split('-')[1]);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    async saveOracleData(oracleId, data, blockHeight) {
        const oracleDataDB = dbInstance.getDatabase('oracleData');
        const recordKey = `oracle-${oracleId}-${blockHeight}`;

        const oracleDataRecord = {
            _id: recordKey,
            oracleId,
            data,
            blockHeight
        };

        try {
            await oracleDataDB.updateAsync(
                { _id: recordKey },
                oracleDataRecord,
                { upsert: true }
            );
            console.log(`Oracle data record saved successfully: ${recordKey}`);
        } catch (error) {
            console.error(`Error saving oracle data record: ${recordKey}`, error);
            throw error;
        }
    }

    async loadOracleData(oracleId, startBlockHeight = 0, endBlockHeight = Number.MAX_SAFE_INTEGER) {
        const oracleDataDB = dbInstance.getDatabase('oracleData');
        try {
            const query = {
                oracleId: oracleId,
                blockHeight: { $gte: startBlockHeight, $lte: endBlockHeight }
            };
            const oracleDataRecords = await oracleDataDB.findAsync(query);
            return oracleDataRecords.map(record => ({
                blockHeight: record.blockHeight,
                data: record.data
            }));
        } catch (error) {
            console.error(`Error loading oracle data for oracleId ${oracleId}:`, error);
            throw error;
        }
    }



    static async getTwap(contractId) {
        // Logic to fetch TWAP data for the given contractId
        // Example:
        // return await someExternalOracleService.getTwap(contractId);
    }

    // Additional methods for managing oracles
}

module.exports = OracleList;
