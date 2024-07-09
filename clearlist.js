const dbInstance = require('./db.js');

class clearlistManager {
    constructor(dbPath = './clearlistDB') {
        this.db = dbInstance.getDatabase('clearlists');
        this.attestationsDb = dbInstance.getDatabase('attestations');
        this.clearlists = new Map();
        this.loadClearlists();
    }

    async createClearlist({ adminAddress, name = '', criteria = [], backupAddress = '' }) {
        const clearlistId = await this.getNextId();
        const clearlistData = {
            adminAddress,
            name,
            criteria,
            backupAddress
        };

      await this.db.updateAsync(
            { _id: clearlistId },
            { $set: { data: clearlistData } },
            { upsert: true }
        );

        return clearlistId;
    }

    async loadClearlists() {
        try {
            const clearlists = await this.db.findAsync({});
            clearlists.forEach(({ _id, data }) => {
                this.clearlists.set(_id, data);
            });
        } catch (error) {
            console.error('Error loading clearlists from the database:', error);
        }
    }

    async verifyAdmin(clearlistId, adminAddress) {
        const clearlist = this.clearlists.get(clearlistId);

        if (!clearlist) {
            throw new Error('Clearlist not found');
        }

        return clearlist.adminAddress === adminAddress;
    }

    async updateAdmin(clearlistId, newAdminAddress) {
        const clearlistKey = `${clearlistId}`;
        const clearlist = this.clearlists.get(clearlistId);

        if (!clearlist) {
            throw new Error('Clearlist not found');
        }

        clearlist.adminAddress = newAdminAddress;
        await this.db.updateAsync({ _id: clearlistKey }, { $set: { data: clearlist } });
        this.clearlists.set(clearlistId, clearlist);

        console.log(`Clearlist ID ${clearlistId} admin updated to ${newAdminAddress}`);
    }

    async getNextId() {
        let maxId = 0;
        await this.loadClearlists()
        for (const key of this.clearlists.keys()) {
            const currentId = parseInt(key);
            if (currentId > maxId) {
                maxId = currentId;
            }
        }
        return maxId + 1;
    }

    async addAttestation(clearlistId, address, metaData) {
        const attestationId = address;
        const attestationData = {
            clearlistId,
            address,
            status: 'active',
            metaData,
            timestamp: new Date().toISOString()
        };

        await this.attestationsDb.updateAsync({ _id: attestationId }, 
            { $set: { data: attestationData } }, 
            { upsert: true });

        return attestationId;
    }

    async revokeAttestation(attestationId, targetAddress, revokeReason) {
        const attestationKey = `attestation:${targetAddress}`;
        const attestation = await this.attestationsDb.findOneAsync({ _id: attestationKey });

        if (!attestation) {
            throw new Error('Attestation not found');
        }

        attestation.data.status = 'revoked';
        attestation.data.id = attestationId;
        attestation.data.revokeReason = revokeReason;
        attestation.data.timestamp = new Date().toISOString();

        await this.attestationsDb.updateAsync({ _id: attestationKey }, { $set: { data: attestation.data } });

        return attestationId;
    }

    async getAttestations(clearlistId) {
        return this.attestationsDb.findAsync({ 'data.clearlistId': clearlistId });
    }

    async getAttestationHistory(address, clearlistId) {
        return this.attestationsDb.findAsync({ 'data.address': address });
    }

    async isAddressInClearlist(clearlistId, address) {
        const attestations = await this.attestationsDb.findAsync({ 'data.clearlistId': clearlistId, 'data.address': address, 'data.status': 'active' });
        return attestations.length > 0;
    }
}

module.exports = clearlistManager;
