const TxUtils = require('./txUtils.js'); // Make sure this path matches where txUtils.js is located
const Channels = require('./channels.js')

async function generateTradeTransaction() {
    const params = {
        propertyId: 's-5-4',
        amount: 1,
        columnA: 0, // Placeholder, will look this up
        satsExpected: 100000,
        tokenOutput: 1,
        payToAddress: 2
    };

    // Determine the correct column for the property
    const channel = await Channels.getChannel('tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m');
    //const isColumnA = channel['A'][params.propertyId] !== undefined;
    //params.columnA = isColumnA ? 'A' : 'B';
    
    const senderChannel = 'tltc1qn3src8lgu50gxhndn5hnd6zrc9yv2364wu858m';
    const senderLTC = 'tltc1qfffvwpftp8w3kv6gg6273ejtsfnu2dara5x4tr';
    
    const signedTx = await TxUtils.tradeUTXO(params, senderChannel, senderLTC);
    
    console.log('Signed Transaction:', signedTx);
}

generateTradeTransaction();
