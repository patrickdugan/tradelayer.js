const assert = require('assert')
const { tlVesting } = require('../vesting.js')

describe('TL', function() {

    beforeEach(function() {
        // Set up for each test
    })

    afterEach(function() {
        // Clean up after each test
        sinon.restore()
    })

    // Assuming activation logic is in place to activate contract series
    describe('initializeContractSeries', function() {
        it('should create contract series correctly after activation', async function() {
            // Simulate activation logic for contract series
            await tlVesting.activateContractSeries()

            // Assert that the contract series are created with correct properties
            const contractSeries = tlVesting.getContractSeries()
            assert.ok(contractSeries)
            assert.equal(contractSeries.marginRequirement, expectedMarginRequirement)
            assert.equal(contractSeries.expiry, expectedExpiry)
            assert.equal(contractSeries.index, expectedIndex)
            // Other assertions for contract properties
        })
    })
})



