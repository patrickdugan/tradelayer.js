const Datastore = require('nedb');
const path = require('path');

// Define the path to your NeDB database file
const dbFilePath = path.join(__dirname, 'nedb-data', 'txIndex.db'); // Replace 'your-database-file.db' with your actual database file name

// Create a new instance of the database
const db = new Datastore({ filename: dbFilePath, autoload: true });

// Clear all entries from the database
db.remove({}, { multi: true }, (err, numRemoved) => {
  if (err) {
    console.error('Error clearing the database:', err);
  } else {
    console.log(`Cleared ${numRemoved} entries from the database.`);
  }
});
