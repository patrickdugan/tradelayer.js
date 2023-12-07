const assert = require('assert');
const TradeLayerManager = require('./vesting.js');
const TallyMap = require('./tally.js');
const InsuranceFund = require('./insurance.js');
const Property = require('./property.js');
const ContractsRegistry = require('./contractRegistry.js');

describe('TradeLayerManager', function() {
    let tradeLayerManager;
    let tallyMap;
    let insuranceFund;
    let property;
    let contractsRegistry;

    before(function() {
        // Mock dependencies
        tallyMap = new TallyMap();
        insuranceFund = new InsuranceFund();
        property = new Property();
        contractsRegistry = new ContractsRegistry();

        tradeLayerManager = new TradeLayerManager(tallyMap, insuranceFund, property, contractsRegistry);
    });

    it('should initialize tokens correctly', function() {
        tradeLayerManager.initializeTokens();
        const TLBalance = tallyMap.getTally(tradeLayerManager.adminAddress, 1);
        const TLVESTBalance = tallyMap.getTally(tradeLayerManager.adminAddress, 2);

        assert.strictEqual(TLBalance, 1500000);
        assert.strictEqual(TLVESTBalance, 1500000);
    });

    // Additional tests for other methods like initializeContractSeries, updateVesting, etc.
});

// Run this using: mocha tradeLayerManagerTest.js
