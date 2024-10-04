const fs = require('fs');
const path = require('path');

const dbDir = './nedb-data';  // Change to your database directory

// Function to delete all files in the directory
function wipeDatabase() {
    fs.readdir(dbDir, (err, files) => {
        if (err) throw err;

        for (const file of files) {
            fs.unlink(path.join(dbDir, file), err => {
                if (err) throw err;
            });
        }
        console.log('Database wiped successfully.');
    });
}

wipeDatabase();
