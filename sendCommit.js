const PropertyManager = require('./property.js');
const TallyMap = require('./tally.js');
const Logic = require('./logic.js');
const litecore = require('bitcore-lib-ltc');
const TxUtils = require('./txUtils');

let params = {
    propertyId:'s-5-4',
    amount:1,
    channelAddress:'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m'
}
    //const { address, privateKey } = generateNewAddress();
    //console.log('Generated new address:', address);

// Function to generate a random number within a range
function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

var random = randomNumber(20000,50000)

    TxUtils.createCommitTransaction('tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m',params,4)
//tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz
//