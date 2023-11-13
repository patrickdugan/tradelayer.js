const bcrypt = require('bcrypt');

const saltRounds = 10; // Number of salt rounds (adjust as needed)
const password = 'pass'; // Replace with your actual password

bcrypt.genSalt(saltRounds, function(err, salt) {
    bcrypt.hash(password, salt, function(err, hash) {
        if (!err) {
            console.log(`Salted Hash Password: ${hash}`);
        } else {
            console.error('Error generating salted hash:', err);
        }
    });
});