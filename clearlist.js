const dbInstance = require('./db.js');

class ClearlistManager {
    constructor() {
        this.db = dbInstance.getDatabase('clearlists');
        this.clearlists = new Map(); // Initialize the clearlists map
        this.loadClearlists(); // Load existing clearlists
    }

    async createClearlist({ adminAddress, name = '', criteria = [], backupAddress = '' }) {
        const clearlistId = await this.getNextId();
        const clearlistData = {
            _id: clearlistId.toString(),
            adminAddress,
            name,
            criteria,
            backupAddress
        };

        await this.db.insertAsync(clearlistData);

        return clearlistId;
    }

    async loadClearlists() {
        try {
            const clearlists = await this.db.findAsync({});
            clearlists.forEach(clearlist => {
                this.clearlists.set(clearlist._id, clearlist);
            });
        } catch (error) {
            console.error('Error loading clearlists from the database:', error);
        }
    }

    async verifyAdmin(clearlistId, adminAddress) {
        const clearlist = this.clearlists.get(clearlistId.toString());

        if (!clearlist) {
            throw new Error('clearlist not found');
        }

        return clearlist.adminAddress === adminAddress;
    }

    async updateAdmin(clearlistId, newAdminAddress) {
        const clearlistIdStr = clearlistId.toString();
        const clearlist = this.clearlists.get(clearlistIdStr);

        if (!clearlist) {
            throw new Error('clearlist not found');
        }

        clearlist.adminAddress = newAdminAddress;
        await this.db.updateAsync({ _id: clearlistIdStr }, { $set: { adminAddress: newAdminAddress } });
        this.clearlists.set(clearlistIdStr, clearlist);

        console.log(`clearlist ID ${clearlistId} admin updated to ${newAdminAddress}`);
    }

    async getNextId() {
        let maxId = 0;
        for (const key of this.clearlists.keys()) {
            const currentId = parseInt(key);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    // Additional methods for managing clearlists
}

module.exports = ClearlistManager;
