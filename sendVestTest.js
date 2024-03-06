const PropertyManager = require('./property.js');
const TallyMap = require('./tally.js');
const Logic = require('./logic.js');
const litecore = require('bitcore-lib-ltc');
const TxUtils = require('./txUtils');

function generateNewAddress() {
    const privateKey = new litecore.PrivateKey(); // Generate a new private key
    const address = privateKey.toAddress(); // Generate the address from the private key
    return {
        address: address.toString(),
        privateKey: privateKey.toString()
    };
}

    //const { address, privateKey } = generateNewAddress();
    //console.log('Generated new address:', address);

// Function to generate a random number within a range
function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

var random = randomNumber(100,200)

    TxUtils.sendTransaction('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8','tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk',3,random,null)
//tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz
//