const assert = require('assert');
const TallyMap = require('./tallyMap.js');

describe('TallyMap', function() {
    let tallyMap;

    before(function() {
        tallyMap = new TallyMap();
    });

    it('should update and retrieve balances', function() {
        const testAddress = 'address1';
        const propertyId = 1;
        tallyMap.updateBalance(testAddress, propertyId, 100, 80, 20);

        const balances = tallyMap.getAddressBalances(testAddress);
        assert.strictEqual(balances.length, 1);
        assert.strictEqual(balances[0].propertyId, propertyId.toString());
        assert.strictEqual(balances[0].amount, 100);
        assert.strictEqual(balances[0].available, 80);
        assert.strictEqual(balances[0].reserved, 20);
    });

    it('should not allow negative balances', function() {
        const testAddress = 'address2';
        const propertyId = 2;

        assert.throws(() => {
            tallyMap.updateBalance(testAddress, propertyId, -100, -50, -50);
        }, /Balance cannot go negative/);
    });

    it('should calculate total tokens correctly', function() {
        const propertyId = 1;
        const total = tallyMap.totalTokens(propertyId);
        assert.strictEqual(total, 100); // Total from previous test
    });

    // Additional tests for save, load, getTally, etc.
});