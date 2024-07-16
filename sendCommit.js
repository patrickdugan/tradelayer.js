const PropertyManager = require('./property.js');
const TallyMap = require('./tally.js');
const Logic = require('./logic.js');
const litecore = require('bitcore-lib-ltc');
const TxUtils = require('./txUtils');

let params = {
    propertyId:4,
    amount:1000,
    channelAddress:'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8'
}
    //const { address, privateKey } = generateNewAddress();
    //console.log('Generated new address:', address);

// Function to generate a random number within a range
function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

var random = randomNumber(20000,50000)

    TxUtils.createCommitTransaction('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8',params,4)
//tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz
//