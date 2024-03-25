// Import the Database class from db.js
const Database = require('./db');

// Get the tradeHistory database instance
const tradeHistoryDB = Database.getCollection('tradeHistory');

// Example: Find all documents in the tradeHistory database and display them
tradeHistoryDB.find({ type: 'contract' })  // Adjust the query to exclude blockHeight
    .then(tradeHistoryData => {
        console.log('Trade History Data:');
        console.log(tradeHistoryData);
    })
    .catch(error => {
        console.error('Error fetching trade history data:', error);
    });