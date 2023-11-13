const level = require('level');

class Activation {
    constructor(dbPath, adminAddress) {
        this.db = level(dbPath);
        this.hardcodedAdminAddress = adminAddress;
        this.consensusVector = {};
    }

    async updateConsensusVector(txType, newState) {
        this.consensusVector[txType] = newState;
        await this.saveConsensusVector();
    }

    async loadConsensusVector() {
        try {
            const storedVector = await this.db.get('consensusVector');
            this.consensusVector = JSON.parse(storedVector);
        } catch (error) {
            console.error('Error loading consensus vector:', error);
            this.consensusVector = {};
        }
    }

    async saveConsensusVector() {
        try {
            await this.db.put('consensusVector', JSON.stringify(this.consensusVector));
            console.log('Consensus vector saved successfully.');
        } catch (error) {
            console.error('Error saving consensus vector:', error);
        }
    }

    isValidActivationTx(tx, adminAddress) {
        return tx.fromAddress === this.hardcodedAdminAddress && adminAddress === this.hardcodedAdminAddress;
    }
}

module.exports = Activation;
