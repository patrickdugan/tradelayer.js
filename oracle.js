var db = require('./db')

class OracleRegistry {
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

    static async getTwap(contractId) {
        // Logic to fetch TWAP data for the given contractId
        // Example:
        // return await someExternalOracleService.getTwap(contractId);
    }

    // Additional methods for managing oracles
}

module.exports = OracleRegistry;
