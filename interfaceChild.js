const { fork } = require('child_process');

class InterfaceChild {
    constructor() {
        // Forking the main process
        this.mainProcess = fork('./main.js');

        this.mainProcess.on('message', (message) => {
            console.log('Message from main process:', message);
        });

        this.mainProcess.on('error', (error) => {
            console.error('Error in main process:', error);
        });

        this.mainProcess.on('exit', (code) => {
            console.log(`Main process exited with code ${code}`);
        });
    }

    async sendCommandToMainProcess(command, args) {
        return new Promise((resolve, reject) => {
            this.mainProcess.send({ command, args });
            this.mainProcess.once('message', (response) => {
                if (response.error) {
                    reject(response.error);
                } else {
                    resolve(response.data);
                }
            });
        });
    }

    async initMain() {
        return await this.sendCommandToMainProcess('initMain');
    }

    // Example method: Get balances for an address
    async getAllBalancesForAddress(address) {
        return await this.sendCommandToMainProcess('getAllBalancesForAddress', { address });
    }

    // Method: Get transaction details
    async getTransaction(txid) {
        return await this.sendCommandToMainProcess('getTransaction', { txid });
    }

    // Method: Get property details
    async getProperty(propertyId) {
        return await this.sendCommandToMainProcess('getProperty', { propertyId });
    }

    // ... Integrate all other methods from Interface.js ...

    // For example, a method to list all properties
    async listProperties() {
        return await this.sendCommandToMainProcess('listProperties');
    }

    // Method to list all activations
    async listActivations() {
        return await this.sendCommandToMainProcess('listActivations');
    }


    async getConsensusHashForBlock(blockHeight) {
        return await this.sendCommandToMainProcess('getConsensusHashForBlock', { blockHeight });
    }

    async getFeatureActivationStatus(featureId) {
        return await this.sendCommandToMainProcess('getFeatureActivationStatus', { featureId });
    }

    async getAllBalancesForAddress(address) {
        return await this.sendCommandToMainProcess('getAllBalancesForAddress', { address });
    }

    async getTotalTokens(propertyId) {
        return await this.sendCommandToMainProcess('getTotalTokens', { propertyId });
    }

    async getBalancesAcrossAllWallets() {
        return await this.sendCommandToMainProcess('getBalancesAcrossAllWallets');
    }

    async isTransactionTypeActive(txType) {
        return await this.sendCommandToMainProcess('isTransactionTypeActive', { txType });
    }

    async getAllActiveTransactionTypes() {
        return await this.sendCommandToMainProcess('getAllActiveTransactionTypes');
    }

    async getAddressesWithBalanceForProperty(propertyId) {
        return await this.sendCommandToMainProcess('getAddressesWithBalanceForProperty', { propertyId });
    }

    async getTransaction(txid) {
        return await this.sendCommandToMainProcess('getTransaction', { txid });
    }

    async getProperty(propertyId) {
        return await this.sendCommandToMainProcess('getProperty', { propertyId });
    }

    async listProperties() {
        return await this.sendCommandToMainProcess('listProperties');
    }

    async getGrants(propertyId) {
        return await this.sendCommandToMainProcess('getGrants', { propertyId });
    }

    async getPayToToken(propertyId) {
        return await this.sendCommandToMainProcess('getPayToToken', { propertyId });
    }

    async listBlockTransactions(blockIndex) {
        return await this.sendCommandToMainProcess('listBlockTransactions', { blockIndex });
    }

    async listPendingTransactions(addressFilter) {
        return await this.sendCommandToMainProcess('listPendingTransactions', { addressFilter });
    }

    // ... Continue adding all methods from Interface.js ...
}

module.exports = InterfaceChild;
