const level = require('level');

class WhitelistManager {
    constructor(dbPath = './whitelistDB') {
        this.db = level(dbPath);
        this.whitelists = new Map(); // Initialize the whitelists map
        this.loadWhitelists(); // Load existing whitelists
    }

    async createWhitelist({ adminAddress, name = '', criteria = [], backupAddress = '' }) {
        const whitelistId = await this.getNextId();
        const whitelistData = {
            adminAddress,
            name,
            criteria,
            backupAddress
        };

        await this.db.put(`whitelist:${whitelistId}`, JSON.stringify(whitelistData));

        return whitelistId;
    }

    async loadWhitelists() {
        try {
            for await (const [key, value] of this.db.iterator({ gt: 'whitelist:', lt: 'whitelist:\xFF' })) {
                this.whitelists.set(key.split(':')[1], JSON.parse(value));
            }
        } catch (error) {
            console.error('Error loading whitelists from the database:', error);
        }
    }

    async verifyAdmin(whitelistId, adminAddress) {
        const whitelistKey = `whitelist:${whitelistId}`;
        const whitelist = this.whitelists.get(whitelistKey);

        if (!whitelist) {
            throw new Error('Whitelist not found');
        }

        return whitelist.adminAddress === adminAddress;
    }

    async updateAdmin(whitelistId, newAdminAddress) {
        const whitelistKey = `whitelist:${whitelistId}`;
        const whitelist = this.whitelists.get(whitelistKey);

        if (!whitelist) {
            throw new Error('Whitelist not found');
        }

        whitelist.adminAddress = newAdminAddress;
        await this.db.put(whitelistKey, JSON.stringify(whitelist));
        this.whitelists.set(whitelistKey, whitelist);

        console.log(`Whitelist ID ${whitelistId} admin updated to ${newAdminAddress}`);
    }

    async getNextId() {
        let maxId = 0;
        for (const [key, value] of this.whitelists) {
            const currentId = parseInt(key.split(':')[1]);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    // Additional methods for managing whitelists
}

module.exports = WhitelistManager;
