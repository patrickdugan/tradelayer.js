var db = require('./db')

class OracleList {
    static instance = null;

    constructor() {
        if (!OracleList.instance) {
            this.oracles = new Map(); // Initialize the oracles map only once
            OracleList.instance = this;
        }

        return OracleList.instance;
    }

    async addOracle(oracleId, oracleData) {
        try {
            // Add to in-memory map
            this.oracles.set(oracleId, oracleData);

            // Add to NeDB database (if applicable)
            const oracleDB = db.getDatabase('oracleList');
            await oracleDB.insertAsync({ _id: oracleId, ...oracleData });

            console.log(`Oracle added: ID ${oracleId}`);
            return true; // Indicate success
        } catch (error) {
            console.error(`Error adding oracle: ID ${oracleId}`, error);
            throw error; // Re-throw the error for the caller to handle
        }
    }

    // Static method to get oracle data
    static async getOracleData(oracleId) {
        const instance = OracleList.getInstance();

        for (const oracle of instance.oracles.values()) {
            if (oracle[oracleId]) {
                return oracle[oracleId];
            }
        }

        console.log(`Oracle data not found for oracle ID: ${oracleId}`);
        return null;
    }

    // Static method to get the singleton instance
    static getInstance() {
        if (!OracleList.instance) {
            OracleList.instance = new OracleList();
        }
        return OracleList.instance;
    }

    static async load() {
        try {
            const oracleDB = db.getDatabase('oracleList');
            const oracles = await oracleDB.findAsync({});

            const instance = OracleList.getInstance();
            for (const oracle of oracles) {
                instance.oracles.set(oracle._id, oracle);
            }

            console.log('Oracles loaded from the database');
        } catch (error) {
            console.error('Error loading oracles from the database:', error);
        }
    }



    static async verifyAdmin(oracleId, adminAddress) {
        const oracleKey = `oracle-${oracleId}`;

        // Check in-memory map first
        const instance = OracleList.getInstance();
        let oracle = instance.oracles.get(oracleKey);

        // If not found in-memory, check the database
        if (!oracle) {
            const oracleDB = db.getDatabase('oracleList');
            oracle = await oracleDB.findOneAsync({ _id: oracleKey });
        }

        // Verify admin address
        return oracle && oracle.adminAddress === adminAddress;
    }


    static async updateAdmin(oracleId, newAdminAddress) {
        const oracleKey = `oracle-${oracleId}`;
        const instance = OracleList.getInstance();
            
        // Get the NeDB datastore for oracles
        const oracleDB = db.getDatabase('oracleList');

        // Fetch the current oracle data
        const oracle = await oracleDB.findOneAsync({ _id: oracleKey });

        if (!oracle) {
            throw new Error('Oracle not found');
        }

        // Update the admin address
        oracle.adminAddress = newAdminAddress;

        // Update the oracle in the database
        await oracleDB.updateAsync({ _id: oracleKey }, { $set: { adminAddress: newAdminAddress } }, {});

        // Optionally, update the in-memory map if you are maintaining one
        this.oracles.set(oracleKey, oracle);

        console.log(`Oracle ID ${oracleId} admin updated to ${newAdminAddress}`);
    }

    static async createOracle(name, adminAddress) {
        const instance = OracleList.getInstance(); // Get the singleton instance
        const oracleId = OracleList.getNextId();
        const oracleKey = `oracle-${oracleId}`;

        const newOracle = {
            _id: oracleKey, // NeDB uses _id as the primary key
            id: oracleId,
            name: name,
            adminAddress: adminAddress,
            data: {} // Initial data, can be empty or preset values
        };

        // Get the NeDB datastore for oracles
        const oracleDB = db.getDatabase('oracleList');

        try {
            // Save the new oracle to the database
            await oracleDB.insertAsync(newOracle);

            // Also save the new oracle to the in-memory map
            instance.oracles.set(oracleKey, newOracle);

            console.log(`New oracle created: ID ${oracleId}, Name: ${name}`);
            return oracleId; // Return the new oracle ID
        } catch (error) {
            console.error('Error creating new oracle:', error);
            throw error; // Re-throw the error for the caller to handle
        }
    }

    static getNextId() {
        const instance = OracleList.getInstance(); // Get the singleton instance
        let maxId = 0;
        for (const key of instance.oracles.keys()) {
            const currentId = parseInt(key.split('-')[1]);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    async saveOracleData(oracleId, data, blockHeight) {
        const oracleDataDB = db.getDatabase('oracleData');
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
        const oracleDataDB = db.getDatabase('oracleData');
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
