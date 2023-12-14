const Validity = require('./validity.js')

async function testValidateActivateTradeLayer() {
    const txId = 'dummyTxId';
    const params = { txTypeToActivate: 0 };
    const sender = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';

    // Mocking isTxTypeActive
    //activationInstance.isTxTypeActive = async () => false;

    const result = await Validity.validateActivateTradeLayer(txId, params, sender);
    console.log('Test validateActivateTradeLayer:', result);
}

testValidateActivateTradeLayer();
/*
async function testValidateTokenIssue() {
    const params = {
        initialAmount: 100,
        ticker: 'TOKEN',
        type: 'native',
        propertyId: 1
    };

    // Mocking isTxTypeActive
    activationInstance.isTxTypeActive = async () => true;

    const result = await validateTokenIssue(params);
    console.log('Test validateTokenIssue:', result);
}

testValidateTokenIssue();

async function testValidateSend() {
    const params = {
        senderAddress: 'senderAddressExample',
        propertyId: 1,
        amount: 50
    };

    // Mocking isTxTypeActive
    activationInstance.isTxTypeActive = async () => true;

    // Mocking getTally
    const TallyMap = require('./tally.js');
    TallyMap.getTally = async () => ({ available: 100 });

    const result = await validateSend(params);
    console.log('Test validateSend:', result);
}

testValidateSend();
*/