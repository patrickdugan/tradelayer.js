const dbInstance = require('./db.js');

class clearlistManager {
    static db = dbInstance.getDatabase('clearlists');
    static attestationsDb = dbInstance.getDatabase('attestations');
    static clearlists = new Map();

    static async createClearlist(adminAddress, name, url, description, backupAddress) {
        const clearlistId = await this.getNextId();
        const clearlistData = {
            adminAddress,
            name,
            description,
            backupAddress
        };

        await this.db.updateAsync(
            { _id: clearlistId },
            { $set: { data: clearlistData } },
            { upsert: true }
        );

        return clearlistId;
    }

    static async loadClearlists() {
        try {
            const clearlists = await this.db.findAsync({});
            clearlists.forEach(({ _id, data }) => {
                this.clearlists.set(_id, data);
            });
        } catch (error) {
            console.error('Error loading clearlists from the database:', error);
        }
    }

    static async getList(id) {
        try {
            const clearlist = await this.db.findOneAsync({ _id: id });
            if (clearlist) {
                return clearlist.data;
            } else {
                console.log(`No clearlist found for ID: ${id}`);
                return null;
            }
        } catch (error) {
            console.error(`Error loading clearlist with ID ${id}:`, error);
            throw error;
        }
    }

    static async verifyAdmin(clearlistId, adminAddress) {
        const clearlist = this.clearlists.get(clearlistId);

        if (!clearlist) {
            throw new Error('Clearlist not found');
        }

        return clearlist.adminAddress === adminAddress;
    }

    static async updateAdmin(clearlistId, newAdminAddress, backup) {
        const clearlistKey = `${clearlistId}`;
        const clearlist = this.clearlists.get(clearlistId);

        if (!clearlist) {
            throw new Error('Clearlist not found');
        }

        if (backup) {
            clearlist.backupAddress = newAdminAddress;
        } else {
            clearlist.adminAddress = newAdminAddress;
        }
        await this.db.updateAsync({ _id: clearlistKey }, { $set: { data: clearlist } });
        this.clearlists.set(clearlistId, clearlist);

        console.log(`Clearlist ID ${clearlistId} admin updated to ${newAdminAddress}`);
    }

    static async getNextId() {
        let maxId = 0;
        await this.loadClearlists();
        for (const key of this.clearlists.keys()) {
            const currentId = parseInt(key);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    static async addAttestation(clearlistId, address, metaData) {
        const attestationId = address;
        const attestationData = {
            clearlistId,
            address,
            status: 'active',
            metaData,
            timestamp: new Date().toISOString()
        };

        await this.attestationsDb.updateAsync(
            { _id: attestationId },
            { $set: { data: attestationData } },
            { upsert: true }
        );

        return attestationId;
    }

    static async revokeAttestation(attestationId, targetAddress, revokeReason) {
        const attestationKey = `attestation:${targetAddress}`;
        const attestation = await this.attestationsDb.findOneAsync({ _id: attestationKey });

        if (!attestation) {
            throw new Error('Attestation not found');
        }

        attestation.data.status = 'revoked';
        attestation.data.id = attestationId;
        attestation.data.revokeReason = revokeReason;
        attestation.data.timestamp = new Date().toISOString();

        await this.attestationsDb.updateAsync(
            { _id: attestationKey },
            { $set: { data: attestation.data } }
        );

        return attestationId;
    }

    static async getAttestations(clearlistId) {
        return this.attestationsDb.findAsync({ 'data.clearlistId': clearlistId });
    }

    static async getAttestationHistory(address, clearlistId) {
        return this.attestationsDb.findAsync({ 'data.address': address });
    }

    static async isAddressInClearlist(clearlistId, address) {
        const attestations = await this.attestationsDb.findAsync({
            'data.clearlistId': clearlistId,
            'data.address': address,
            'data.status': 'active'
        });
        return attestations.length > 0;
    }
}

module.exports = clearlistManager;
