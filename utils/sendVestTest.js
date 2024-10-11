const PropertyManager = require('../src/property.js');
const TallyMap = require('../src/tally.js');
const Logic = require('../src/logic.js');
const litecore = require('bitcore-lib-ltc');
const TxUtils = require('../src/txUtils.js');
const {createClient }= require('../src/client.js')
createClient('ltc')

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

var random = randomNumber(10,20)

    TxUtils.sendTransaction('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8','tltc1q89kkgaslk0lt8l90jkl3cgwg7dkkszn73u4d2t',5,10,null)
    /*tltc1qp5z2la8sy69np798pc36up5zk2vg0fw2g7pml2*/
//tltc1qpgenrwmg9hxgv23mnvd2t7085prjkge2xw7myz
//tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m
