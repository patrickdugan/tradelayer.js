const Validity = {
   async validateActivateTradeLayer(txid, params) {
        const sender = await TxUtils.getSender(txid);
        return sender === params.adminAddress; // Assuming adminAddress is part of params
    },

    validateTokenIssue: (params) => {
        // Implement validation logic
        return true; // or false
    },

    validateSend: (params) => {
        // Implement validation logic
        return true; // or false
    },

    validateTradeTokenForUTXO: (params) => {
        // Implement validation logic
        return true; // or false
    },

    validateCommitToken: (params) => {
        // Implement validation logic
        return true; // or false
    },

    // ... continue for other transaction types ...

    validateCreateFutureContractSeries: (params) => {
        // Implement validation logic
        return true; // or false
    },

    async verifyAdmin(whitelistId, adminAddress) {
        // Logic to verify if the adminAddress is the admin of the whitelist with whitelistId
    },

    async validateWithdrawal(withdrawalTx) {
        // Extract necessary details from the withdrawal transaction
        const { channelAddress, propertyId, amount } = withdrawalTx;

        // Retrieve the channel's current balance for the propertyId
        const channelBalance = await tradeChannel.getChannelBalance(channelAddress, propertyId);

        // Check if the withdrawal amount is less than or equal to the available balance
        if (amount <= channelBalance) {
            // Proceed with the withdrawal
            return true; // Or additional logic to process the withdrawal
        } else {
            // Insufficient balance, possibly due to a recent trade or another withdrawal
            return false; // Or handle the invalid withdrawal scenario
        }
    },

    // ... continue until transaction type 36 ...
};

module.exports = Validity;
