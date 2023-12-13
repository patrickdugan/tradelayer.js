const PropertyManager = require('./PropertyManager');
const TallyMap = require('./TallyMap');
const Logic = require('./Logic');

async function testSendTLVEST() {
    // Initialize components
    const propertyManager = PropertyManager.getInstance();
    const tallyMap = TallyMap.getInstance();

    // Generate a new address (pseudo-code)
    const newAddress = generateNewAddress();

    // Send 1 TLVEST from admin address to new address
    const adminAddress = 'admin-address'; // Replace with actual admin address
    const TLVESTPropertyId = 2; // Assuming TLVEST has property ID 2
    await Logic.sendToken(false, adminAddress, newAddress, TLVESTPropertyId, 1);

    // Check balances
    const newAddressBalance = await tallyMap.getTally(newAddress, TLVESTPropertyId);
    console.log('New address balance:', newAddressBalance);

    // Assertions (pseudo-code)
    assert(newAddressBalance.vesting === 1, 'Vesting balance should be 1 TL');
}

testSendTLVEST();
