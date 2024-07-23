const PropertyManager = require('./property.js');
const TallyMap = require('./tally.js');
const Logic = require('./logic.js');
const litecore = require('bitcore-lib-ltc');
const TxUtils = require('./txUtils');

    //const { address, privateKey } = generateNewAddress();
    //console.log('Generated new address:', address);

const params = {
	propertyId:4,
	amount: 998,
	isColumnA: 0,
	destinationAddr: 'tltc1q7r6x4v67n8vnaftnz8pk33yvf9t9gpynuwdfgk'
}

    TxUtils.createTransferTransaction('tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8',params)


