const dbInstance = require('./db.js');

class clearlistManager {
    static clearlists = new Map();
    static banlist = ["US", "KP", "SY", "RU", "IR", "CU"];

    static async createClearlist(adminAddress, name, url, description, backupAddress,id) {

        if(!id){
            id = await this.getNextId();
        }
        
        const clearlistData = {
            id: id,
            admin: adminAddress,
            name: name,
            description: description,
            backup: backupAddress
        };

        const base = await dbInstance.getDatabase('clearlists')
        await base.updateAsync(
            { _id: id },
            { $set: { data: clearlistData } },
            { upsert: true }
        );

        return clearlistData;
    }

    static async loadClearlists() {
        try {
            const base = await dbInstance.getDatabase('clearlists')
            const clearLists = await base.findAsync({});
            clearLists.forEach(({ _id, data }) => {
                this.clearlists.set(_id, data);
            });

            return clearLists
        } catch (error) {
            console.error('Error loading clearlists from the database:', error);
        }
    }

    static async getClearlistById(clearlistId) {
        try {
            // Load all clearlists into memory
            await this.loadClearlists();

            // Check if the clearlistId exists in the Map
            if (this.clearlists.has(clearlistId)) {
                const clearlistData = this.clearlists.get(clearlistId);
                console.log(`Clearlist found: ID ${clearlistId}`, clearlistData);
                return clearlistData;
            }

            console.log(`Clearlist ID ${clearlistId} not found.`);
            return false; // Return false if the clearlistId doesn't exist
        } catch (error) {
            console.error(`Error finding clearlist with ID ${clearlistId}:`, error.message);
            throw error;
        }
    }


    static async getList(id) {
        try {
            const base = await dbInstance.getDatabase('attestations')
            const clearlist = await base.findOneAsync({ _id: id });
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

    static async addAttestation(clearlistId, address, metaData,block) {
        const attestationId = address;
        const attestationData = {
            listId:clearlistId,
            address: address,
            status: 'active',
            data: metaData,
            timestamp: block
        };

        const base = await dbInstance.getDatabase('attestations')
        await base.updateAsync(
            { _id: attestationId },
            { $set: { data: attestationData } },
            { upsert: true }
        );

        return attestationId;
    }

    static async revokeAttestation(attestationId, targetAddress, revokeReason,block) {
        const attestationKey = `attestation:${targetAddress}`;
        const base= await dbInstance.getDatabase('attestations')
        const attestation = await base.findOneAsync({ _id: attestationKey });

        if (!attestation) {
            throw new Error('Attestation not found');
        }

        attestation.data.status = 'revoked';
        attestation.data.id = attestationId;
        attestation.data.revokeReason = revokeReason;
        attestation.data.timestamp = block

        await this.attestationsDb.updateAsync(
            { _id: attestationKey },
            { $set: { data: attestation.data } }
        );

        return attestationId;
    }

    static async getCountryCodeByAddress(address) {
        try {
            const base = await dbInstance.getDatabase('attestations');
            
            // Fetch all attestations for the given address
            const attestations = await base.findAsync({ 'data.address': address });

            if (!attestations || attestations.length === 0) {
                console.log(`No attestations found for address: ${address}`);
                return null; // No attestations for this address
            }

            // Loop through attestations to find one with clearListId: 0 and a valid countryCode
            for (const attestation of attestations) {
                const { listId, data} = attestation.data;
                
                if (listId === 0 && data) {
                    return {
                        address,
                        countryCode: data,
                        blockHeight: attestation.data.blockHeight || null, // Optional blockHeight in metadata
                    };
                }
            }

            // If no valid attestation with clearListId: 0 and countryCode is found
            console.log(`No valid attestation with clearListId 0 and country code found for address: ${address}`);
            return null;
        } catch (error) {
            console.error(`Error fetching country code for address ${address}:`, error);
            return null; // Gracefully return null on error
        }
    }

    static async setBanlist(banlistArray,block) {
        try {
            const base = await dbInstance.getDatabase('clearlists');
            await base.updateAsync(
                { _id: 'globalBanlist' }, // Fixed ID for the banlist entity
                { $set: { data: banlistArray, timestamp: block } },
                { upsert: true }
            );
            console.log('Banlist updated successfully.');
        } catch (error) {
            console.error('Error updating Banlist in database:', error);
            throw error;
        }
        this.banlist= banlistArray
    }

    static async getBanlist() {
        try {
            const base = await dbInstance.getDatabase('clearlists');
            const banlist = await base.findAsync({ _id: 'globalBanlist' });
            if (banlist) {
                return banlist.data; // Return the banlist array
            } else {
                console.log('No Banlist found in the database.');
                return null; // Return null if no Banlist exists
            }
        } catch (error) {
            console.error('Error fetching Banlist from database:', error);
            throw error;
        }
    }

    static async getAttestations(clearlistId) {
        const base = await dbInstance.getDatabase('attestations')
        return await base.findAsync({ 'data.clearlistId': clearlistId });
    }

    static async getAttestationHistory(address, clearlistId) {

        const base = await dbInstance.getDatabase('attestations')
        return await base.findAsync({ 'data.address': address });
    }

    static async isAddressInClearlist(clearlistId, address) {

        const base = await dbInstance.getDatabase('attestations')
        const attestations = await base.findAsync({
            'data.clearlistId': clearlistId,
            'data.address': address,
            'data.status': 'active'
        });
        return attestations.length > 0;
    }
}

module.exports = clearlistManager;
