async function testSendLargeAmount() {
    // Initialize components
    const adminAddress = 'admin-address'; // Replace with actual admin address
    const TLVESTPropertyId = 2; // Assuming TLVEST has property ID 2
    const largeAmount = 2000000;

    // Send 2 million TLVEST from admin address
    try {
        await Logic.sendToken(false, adminAddress, 'recipient-address', TLVESTPropertyId, largeAmount);
    } catch (error) {
        console.log('Expected error:', error.message);
        // Assertions (pseudo-code)
        assert(error.message.includes('Insufficient balance'), 'Transaction should be invalid due to insufficient balance');
    }
}

testSendLargeAmount();
