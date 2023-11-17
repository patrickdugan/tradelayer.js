const level = require('level');

class WhitelistManager {
    constructor(dbPath = './whitelistDB') {
        this.db = level(dbPath);
        this.nextWhitelistId = 1;
    }

    async createWhitelist({ adminAddress, name = '', criteria = [], backupAddress = '' }) {
        const whitelistId = this.nextWhitelistId++;
        const whitelistData = {
            adminAddress,
            name,
            criteria,
            backupAddress
        };

        await this.db.put(`whitelist:${whitelistId}`, JSON.stringify(whitelistData));

        return whitelistId;
    }

    // Additional methods for managing whitelists (e.g., update, delete, fetch)
}

module.exports = WhitelistManager