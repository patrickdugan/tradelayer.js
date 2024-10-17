const crypto = require('crypto');
const TxUtils = require('../src/txUtils.js'); // Assuming TxUtils contains the necessary transaction utility functions
const client = require('../src/client.js')


async function issueContractSeries(adminAddress, underlyingOracleId, collateralPropertyId, leverage, expiryPeriod, series) {
    try {
        // Define the contract series ticker (or any identifier)
        const instance = new client()
        instance.init()
        await new Promise(resolve => setTimeout(resolve, 700));

        // Create Contract Series
        const contractTxId = await TxUtils.createContractSeriesTransaction(adminAddress, {
            native: false,
            underlyingOracleId: 1,
            onChainData: '',
            notionalPropertyId: 0,
            notionalValue: 1,
            collateralPropertyId: 5,
            leverage: leverage,
            expiryPeriod: expiryPeriod,
            series: series,
            inverse: false,
            fee: false
        });

        console.log(`Contract series issued successfully. Transaction ID: ${contractTxId}`);
    } catch (error) {
        console.error('Error creating oracle and issuing contract:', error);
    }
}

// Example usage:
const adminAddress = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"; // Replace with your admin address
const underlyingOracleId = 1; // Replace with your underlying oracle ID
const collateralPropertyId = 5; // Replace with your collateral property ID
const leverage = 10; // Example leverage
const expiryPeriod = 4032; // Example expiry period
const series = 5; // Example series number

issueContractSeries(adminAddress, underlyingOracleId, collateralPropertyId, leverage, expiryPeriod, series);