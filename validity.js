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
    }

    // ... continue until transaction type 36 ...
};

module.exports = Validity;
