const util = require('util');
const dbInstance = require('../src/db.js'); // your wrapper

async function main() {
    const orderBooksDB = dbInstance.getDatabase('orderBooks');

    // Ensure database is actually loaded
    if (typeof orderBooksDB.loadDatabase === 'function') {
        await new Promise((resolve, reject) => {
            orderBooksDB.loadDatabase(err => err ? reject(err) : resolve());
        });
    }

    // Promisify the datastore if async helpers aren’t present
    if (!orderBooksDB.findOneAsync) {
        orderBooksDB.findOneAsync = util.promisify(orderBooksDB.findOne.bind(orderBooksDB));
        orderBooksDB.findAsync     = util.promisify(orderBooksDB.find.bind(orderBooksDB));
    }

    const key = '2';  // try loading contract 2
    console.log("Trying to load key:", key);

    const record = await orderBooksDB.findOneAsync({ _id: key });

    if (!record) {
        console.log("❌ Not found");
    } else {
        console.log("✔️ Found:");
        console.log(record);
        console.log("Parsed value:", JSON.parse(record.value));
    }
}

main().catch(console.error);
