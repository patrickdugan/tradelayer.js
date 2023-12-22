const crypto = require('crypto');
const TxUtils = require('./txUtils.js'); // Assuming TxUtils contains the necessary transaction utility functions

async function issueContractSeries(adminAddress, underlyingOracleId, collateralPropertyId, leverage, expiryPeriod, series) {
    try {
        // Define the contract series ticker (or any identifier)
        const contractSeriesTicker = "YourContractSeriesTicker"; // Replace with actual ticker or identifier

        console.log(`Issuing a contract series: ${contractSeriesTicker}`);

        // Create Contract Series
        const contractTxId = await TxUtils.createContractSeriesTransaction(adminAddress, {
            native: false,
            underlyingOracleId: underlyingOracleId,
            dataIndex: 0,
            onChainData: [],
            notionalPropertyId: 0,
            notionalValue: 0.01,
            collateralPropertyId: collateralPropertyId,
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
const adminAddress = "YourAdminAddress"; // Replace with your admin address
const underlyingOracleId = 1; // Replace with your underlying oracle ID
const collateralPropertyId = 2; // Replace with your collateral property ID
const leverage = 10; // Example leverage
const expiryPeriod = 100; // Example expiry period
const series = 5; // Example series number

issueContractSeries(adminAddress, underlyingOracleId, collateralPropertyId, leverage, expiryPeriod, series);
