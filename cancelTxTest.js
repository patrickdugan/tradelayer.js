const TxUtils = require('./txUtils.js');

async function cancelOrders() {
    // Admin address
    const adminAddress = 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8';

    // Mode 1: Cancel all contract orders
    const cancelParamsMode1 = {
        fromAddress: adminAddress,
        isContract: 0,
        offeredPropertyId: 3, // Replace with the correct property ID
        desiredPropertyId: 4, // Replace with the correct property ID
        cancelAll: true,
    };

    await TxUtils.createCancelTransaction(adminAddress, cancelParamsMode1, 6);

    // Mode 2: Cancel a specific contract order by txid
    const cancelParamsMode2 = {
        fromAddress: adminAddress,
        isContract: 1,
        contractId: 1, // Replace with the correct property ID
        cancelAll: 0,
        cancelParams: {
            txid: '8b146ed06d51a7856e3f27ba1d0d80229b34885cbc63784a2c1051de1ccdc37b', // Replace with the actual txid
        },
    };

    //await TxUtils.createCancelTransaction(adminAddress, cancelParamsMode2, 6);

    // Mode 3: Cancel contract buy orders above 0.5
    const cancelParamsMode3Buy = {
        fromAddress: adminAddress,
        isContract: 0,
        offeredPropertyId: 3, // Replace with the correct property ID
        desiredPropertyId: 4, // Replace with the correct property ID
        cancelAll: 0,
        cancelParams: {
            price: 0.5,
            side: 1,
        },
    };

    await TxUtils.createCancelTransaction(adminAddress, cancelParamsMode3Buy, 6);

    // Mode 4: Cancel contract sell orders below 0.48
    const cancelParamsMode4Sell = {
        fromAddress: adminAddress,
        isContract: 1,
        contractId: 1, // Replace with the correct property ID
        cancelAll: 1/*,
        cancelParams: {
            price: 42500, // Replace with the actual price
            side: 0,
        },*/
    };

    await TxUtils.createCancelTransaction(adminAddress, cancelParamsMode4Sell, 6);
}

// Call the asynchronous function
cancelOrders();
