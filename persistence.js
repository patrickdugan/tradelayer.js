const level = require('level');

// Database setup
const db = level('./tradeLayerDB');

class BlockchainPersistence {
    constructor() {
        this.lastKnownBlockHash = '';
    }

    /**
     * Updates the last known block hash.
     * @param {String} blockHash - The hash of the latest block
     */
    async updateLastKnownBlock(blockHash) {
        try {
            await db.put('lastKnownBlock', blockHash);
            this.lastKnownBlockHash = blockHash;
            console.log('Last known block updated:', blockHash);
        } catch (error) {
            console.error('Error updating last known block:', error);
        }
    }

    /**
     * Detects a blockchain reorganization.
     * @param {String} currentBlockHash - The hash of the current block
     * @returns {Boolean} True if a reorganization is detected, false otherwise
     */
    async detectReorg(currentBlockHash) {
        try {
            const storedBlockHash = await db.get('lastKnownBlock');
            if (storedBlockHash !== currentBlockHash) {
                console.log('Reorganization detected');
                return true;
            }
            return false;
        } catch (error) {
            if (error.type === 'NotFoundError') {
                console.log('No last known block found');
                return false;
            } else {
                console.error('Error detecting reorganization:', error);
                return false;
            }
        }
    }

    /**
     * Handles a detected reorganization by reverting to the last checkpoint.
     */
    async handleReorg() {
        // Load the last saved state from the checkpoint
        const state = await this.loadState();

        if (state) {
            // Revert system state to the last saved state
            console.log('Reverting to last known good state');
            // Additional logic to revert system state goes here

            // After reverting, resume processing from the last known good block
            // This might involve re-scanning blocks from the last known good block
            // to the current block, applying changes to the reverted state
        } else {
            console.error('No saved state available to revert to');
            // Handle the situation when no checkpoint is available
        }
    }

    /**
     * Loads the saved state from a checkpoint.
     * This is a placeholder and needs implementation based on how state is saved.
     */
    async loadState() {
        // Placeholder implementation
        try {
            const state = await db.get('savedState');
            return state;
        } catch (error) {
            console.error('Error loading state:', error);
            return null;
        }
    }
}

module.exports = BlockchainPersistence;
