const assert = require('assert')
const { tlVesting } = require('../vesting.js')

describe('TradeLayerManager', function () {

    beforeEach(function () {
        // Set up for each test
    })

    afterEach(function () {
        // Clean up after each test
    })

    describe('calculateTradeRebates', function () {
        it('should calculate trade rebates correctly based on cumulative volume', function () {
            // Simulate different cumulative volume scenarios
            const lowVolumeRebate = tlVesting.calculateTradeRebates(lowCumulativeVolume)
            const highVolumeRebate = tlVesting.calculateTradeRebates(highCumulativeVolume)

            // Assert that rebates are within expected limits
            assert(lowVolumeRebate >= minRebate && lowVolumeRebate <= maxRebate)
            assert(highVolumeRebate >= minRebate && highVolumeRebate <= maxRebate)
        })
    })
})
