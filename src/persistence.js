const db = require('./db.js');
const consensus = require('./consensus.js');  // Import the consensus file for hash and snapshot logic

class BlockchainPersistence {
    static lastKnownBlockHash = '';
    static checkpointInterval = 1000;

    /**
     * Updates the last known block hash.
     * @param {String} blockHash - The hash of the latest block
     */
    static async updateLastKnownBlock(blockHash) {
        try {
            const query = { _id: 'lastKnownBlock' };
            const update = { $set: { value: blockHash } };
            await db.getDatabase('persistence').updateAsync(query, update, { upsert: true });
            this.lastKnownBlockHash = blockHash;
            console.log('Last known block updated:', blockHash);
        } catch (error) {
            console.error('Error updating last known block:', error);
        }
    }

    /**
     * Manage checkpoints based on block intervals.
     * @param {number} currentBlockNumber - The current block number
     */
    static async manageCheckpoints(currentBlockNumber) {
        if (currentBlockNumber % this.checkpointInterval === 0) {
            await this.saveState(currentBlockNumber);
            console.log(`Checkpoint created at block ${currentBlockNumber}`);
        }
    }

     /**
     * Detects a blockchain reorganization.
     * @param {String} currentBlockHash - The hash of the current block
     * @returns {Boolean} True if a reorganization is detected, false otherwise
     */
    static async detectReorg(currentBlockHash) {
        try {
            const query = { _id: 'lastKnownBlock' };
            const result = await db.getDatabase('persistence').findOneAsync(query);
            const storedBlockHash = result ? result.value : null;
            if (storedBlockHash !== currentBlockHash) {
                console.log('Reorganization detected');
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error detecting reorganization:', error);
            return false;
        }
    }

    /**
     * Saves the blockchain state using consensus snapshot logic and includes the hash.
     * @param {number} blockNumber - The block number to associate with the saved state
     */
    static async saveState(blockNumber) {
        try {
            const { snapshot, consensusHash } = await consensus.getConsensusSnapshot(true);  // Get both hash and state

            const state = {
                blockNumber,
                snapshot,
                consensusHash
            };

            const query = { _id: `state-${blockNumber}` };
            const update = { $set: { value: JSON.stringify(state) } };
            await db.getDatabase('persistence').updateAsync(query, update, { upsert: true });

            console.log(`State for block ${blockNumber} saved successfully with hash ${consensusHash}`);
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    /**
     * Loads the blockchain state from the most recent checkpoint.
     * @param {number} blockNumber - The block number of the state to load
     * @returns {Object|null} The loaded state or null if not found
     */
    static async loadStateFromCheckpoint(blockNumber) {
        try {
            const query = { _id: `state-${blockNumber}` };
            const result = await db.getDatabase('persistence').findOneAsync(query);
            if (result) {
                const state = JSON.parse(result.value);
                console.log(`Loaded state for block ${blockNumber}`);
                return state;
            } else {
                console.error(`State not found for block ${blockNumber}`);
                return null;
            }
        } catch (error) {
            console.error(`Error loading state from block ${blockNumber}:`, error);
            return null;
        }
    }

    /**
     * Prunes old snapshots based on block intervals.
     * @param {number} currentBlockNumber - The current block number
     * @param {number} retainBlocks - The number of blocks to retain
     */
    static async pruneOldSnapshots(currentBlockNumber, retainBlocks = 10000) {
        try {
            const lowerBoundBlockNumber = currentBlockNumber - retainBlocks;
            const stream = await db.getDatabase('persistence').findAsync({});
            
            stream.forEach(async (doc) => {
                const blockNumber = parseInt(doc._id.split('-')[1], 10);
                if (blockNumber < lowerBoundBlockNumber) {
                    await db.getDatabase('persistence').removeAsync({ _id: doc._id });
                    console.log(`Pruned snapshot for block ${blockNumber}`);
                }
            });
        } catch (error) {
            console.error('Error pruning old snapshots:', error);
        }
    }

    /**
     * Bootstrap function to provide the latest state snapshot and hash to other nodes.
     * @returns {Object} The latest snapshot and consensus hash
     */
    static async bootstrap() {
        try {
            const latestBlockNumber = await this.getLatestCheckpointBlockNumber();  // You may need to implement this
            const state = await this.loadStateFromCheckpoint(latestBlockNumber);
            if (!state) {
                throw new Error('No state available to bootstrap.');
            }

            return {
                blockNumber: state.blockNumber,
                snapshot: state.snapshot,
                consensusHash: state.consensusHash
            };
        } catch (error) {
            console.error('Error during bootstrap:', error);
            throw error;
        }
    }

    /**
     * Utility to get the latest checkpoint block number.
     * Placeholder function — you'll need to implement this based on your needs.
     * @returns {number} The latest checkpoint block number
     */
    static async getLatestCheckpointBlockNumber() {
        // Logic to determine the latest checkpoint block number
        const query = { _id: { $regex: /^state-/ } };
        const sort = { blockNumber: -1 };
        const result = await db.getDatabase('persistence').findAsync(query).sort(sort).limit(1);
        return result.length > 0 ? result[0].blockNumber : null;
    }
}

module.exports = BlockchainPersistence;
