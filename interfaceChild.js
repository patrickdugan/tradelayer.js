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

    // ... Continue adding all methods from Interface.js ...
}

module.exports = InterfaceChild;
