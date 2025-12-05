   const dbInstance = require('../src/db.js'); // adjust path!!
 
// testOrderbookKeys.js
//
// Run with:  node testOrderbookKeys.js
//
// This script checks whether your orderBooks collection
// contains keys stored as NUMBERS or STRINGS.
// It also tests findOneAsync using both key types.
//

(async () => {
    const orderBooksDB = await dbInstance.getDatabase('orderBooks');

    console.log("\n=== 🔍 SCANNING ORDERBOOK DB KEYS ===\n");

    const all = await orderBooksDB.findAsync({});
    
    if (!all.length) {
        console.log("⚠️  No records found in orderBooks DB.");
        process.exit(0);
    }

    console.log(`Found ${all.length} entries:\n`);

    for (const rec of all) {
        console.log(`• _id:`, rec._id, ` (typeof: ${typeof rec._id})`);
    }

    console.log("\n=== 🧪 TESTING READBACK USING STRING AND NUMBER KEYS ===\n");

    // Extract all unique IDs found
    const keys = [...new Set(all.map(r => r._id))];

    for (const key of keys) {
        const asString = String(key);
        const asNumber = Number(key);

        console.log(`\nKey in DB: ${key} (typeof ${typeof key})`);
        console.log(`Testing _id lookup with "${asString}" (string)`);
        let stringLookup = await orderBooksDB.findOneAsync({ _id: asString });
        console.log("→ Result:", stringLookup ? "FOUND" : "null");

        console.log(`Testing _id lookup with ${asNumber} (number)`);
        let numberLookup = await orderBooksDB.findOneAsync({ _id: asNumber });
        console.log("→ Result:", numberLookup ? "FOUND" : "null");
    }

    console.log("\n=== 📌 SUMMARY ===\n");
    console.log("If string lookup returns null but number lookup returns FOUND (or vice versa),");
    console.log("then your liquidation code is querying with the WRONG TYPE.\n");
    console.log("Fix: Always stringify keys before storing and before querying.\n");

    process.exit(0);
})();
