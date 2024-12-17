function hexToBase36(hex) {
    try {
        const bigIntValue = BigInt('0x' + hex);
        return bigIntValue.toString(36);
    } catch (err) {
        console.error('Error converting Hex to Base36:', err.message);
        return null;
    }
}

// Test Function
function testHexToBase36Consistency() {
    const testHex = '9dbe78a08985827d8ba2459466a770c831155cf5d3d03abf5e5e2cb2351103e6';
    const expectedBase36 = '3xjcq2nduqyz7bey9tq9uqihxgyt15lomgapljtojujlj3tckm';

    console.log('Original Hex:', testHex);

    // Convert Hex to Base36
    const base36Result = hexToBase36(testHex);
    console.log('Base36 Result:', base36Result);

    // Check Consistency
    if (base36Result === expectedBase36) {
        console.log('✅ Consistent Base36 conversion!');
    } else {
        console.error('❌ Base36 conversion mismatch!');
    }
}

// Run the Test
console.log("=== Hex to Base36 Consistency Test ===");
testHexToBase36Consistency();
