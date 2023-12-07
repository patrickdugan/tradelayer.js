const BlockchainPersistence = require('./BlockchainPersistence');

describe('BlockchainPersistence', () => {
    let blockchainPersistence;

    beforeEach(() => {
        blockchainPersistence = new BlockchainPersistence();
        // Setup for test database connection
    });

    afterEach(() => {
        // Clean up database or mock after each test
    });

    test('should update last known block hash', async () => {
        const testBlockHash = '000000testhash';
        await blockchainPersistence.updateLastKnownBlock(testBlockHash);
        const storedHash = await blockchainPersistence.getLastKnownBlock();
        expect(storedHash).toBe(testBlockHash);
    });

    // Add more tests for other methods
});
