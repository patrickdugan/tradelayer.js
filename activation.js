const {activationsDB} = require('./db')
const Logic = require('./logic.js');
const TL = require('./vesting.js')

const testAdmin = "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8"

class Activation {
    constructor(dbPath, adminAddress) {

        this.hardcodedAdminAddress = adminAddress;
        this.consensusVector = {};
    }

    async updateConsensusVector(txType, newState) {
        this.consensusVector[txType] = newState;
        await this.saveConsensusVector();
    }

    async loadConsensusVector() {
        try {
            const storedVector = await this.db.get('consensusVector');
            this.consensusVector = JSON.parse(storedVector);
        } catch (error) {
            console.error('Error loading consensus vector:', error);
            this.consensusVector = {};
        }
    }

    async saveConsensusVector() {
        try {
            await activationsDB.put('consensusVector', JSON.stringify(this.consensusVector));
            console.log('Consensus vector saved successfully.');
        } catch (error) {
            console.error('Error saving consensus vector:', error);
        }
    }

    // New Method to save activations list
    async saveActivationsList() {
        try {
            await activationsDB.put('activationsList', JSON.stringify(this.txRegistry));
            console.log('Activations list saved successfully.');
        } catch (error) {
            console.error('Error saving activations list:', error);
        }
    }

    // New Method to load activations list
    async loadActivationsList() {
        try {
            const storedList = await activationsDB.get('activationsList');
            this.txRegistry = JSON.parse(storedList);
            console.log('Activations list loaded successfully.');
        } catch (error) {
            console.error('Error loading activations list:', error);
            this.txRegistry = {}; // Reset to empty object if loading fails
        }
    }


        // Example helper functions (implementations depend on your specific logic and data structures)
    async activate(txType, senderAddress) {

    if (txType === 0) {
                // Initial setup for the first transaction
                await TL.initializeTokens();  // Create propertyId 1 and 2 for TL token
                await TL.initializeContractSeries();
                await this.initializeTxRegistry();  // With pre-populated types and logic
            
                    await activateRegistrySwitch(senderAddress);  // Activate the switch in the registry
        }else{
            await loadActivationsList()
            this.txRegistry[txType].active = true;
            await this.saveActivationsList(); // Save the updated activations list
           
        }
    }

    async initializeTxRegistry() {
        // Initialize the transaction registry
        this.txRegistry = {
            0: { name: "Activate TradeLayer", logicFunction: Logic.activateTradeLayer, active: true },
            1: { name: "Token Issue", logicFunction: Logic.tokenIssue, active: false },
            2: { name: "Send", logicFunction: Logic.sendToken, active: false },
            3: { name: "Trade Token for UTXO", logicFunction: Logic.tradeTokenForUTXO, active: false },
            4: { name: "Commit Token", logicFunction: Logic.commitToken, active: false },
            5: { name: "On-chain Token for Token", logicFunction: Logic.onChainTokenForToken, active: false },
            6: { name: "Create Whitelist", logicFunction: Logic.createWhitelist, active: false },
            7: { name: "Update Admin", logicFunction: Logic.updateAdmin, active: false },
            8: { name: "Issue Attestation", logicFunction: Logic.issueAttestation, active: false },
            9: { name: "Revoke Attestation", logicFunction: Logic.revokeAttestation, active: false },
            10: { name: "Grant Managed Token", logicFunction: Logic.grantManagedToken, active: false },
            11: { name: "Redeem Managed Token", logicFunction: Logic.redeemManagedToken, active: false },
            12: { name: "Create Oracle", logicFunction: Logic.createOracle, active: false },
            13: { name: "Publish Oracle Data", logicFunction: Logic.publishOracleData, active: false },
            14: { name: "Close Oracle", logicFunction: Logic.closeOracle, active: false },
            15: { name: "Create Future Contract Series", logicFunction: Logic.createFutureContractSeries, active: false },
            16: { name: "Exercise Derivative", logicFunction: Logic.exerciseDerivative, active: false },
            17: { name: "Trade Contract On-chain", logicFunction: Logic.tradeContractOnchain, active: false },
            18: { name: "Trade Contract Channel", logicFunction: Logic.tradeContractChannel, active: false },
            19: { name: "Trade Tokens Channel", logicFunction: Logic.tradeTokensChannel, active: false },
            20: { name: "Withdrawal", logicFunction: Logic.withdrawal, active: false },
            21: { name: "Transfer", logicFunction: Logic.transfer, active: false },
            22: { name: "Settle Channel PNL", logicFunction: Logic.settleChannelPNL, active: false },
            23: { name: "Mint Synthetic", logicFunction: Logic.mintSynthetic, active: false },
            24: { name: "Redeem Synthetic", logicFunction: Logic.redeemSynthetic, active: false },
            25: { name: "Pay to Tokens", logicFunction: Logic.payToTokens, active: false },
            26: { name: "Create Option Chain", logicFunction: Logic.createOptionChain, active: false },
            27: { name: "Trade Bai Urbun", logicFunction: Logic.tradeBaiUrbun, active: false },
            28: { name: "Trade Murabaha", logicFunction: Logic.tradeMurabaha, active: false },
            29: { name: "Issue Invoice", logicFunction: Logic.issueInvoice, active: false },
            30: { name: "Batch Move Zk Rollup", logicFunction: Logic.batchMoveZkRollup, active: false },
            31: { name: "Publish New Tx", logicFunction: Logic.publishNewTx, active: false },
            32: { name: "Create Derivative of LRC20 or RGB", logicFunction: Logic.createDerivativeOfLRC20OrRGB, active: false },
            33: { name: "Register OP_CTV Covenant", logicFunction: Logic.registerOPCTVCovenant, active: false },
            34: { name: "Redeem OP_CTV Covenant", logicFunction: Logic.redeemOPCTVCovenant, active: false },
            35: { name: "Mint Colored Coin", logicFunction: Logic.mintColoredCoin, active: false },
            // ... potentially other transaction types ...
        };
    },

     /**
     * Checks if a transaction type is active in the transaction registry.
     * @param {number} txTypeNumber - The transaction type number to check.
     * @returns {boolean} - Returns true if the transaction type is active, false otherwise.
     */
    isTxTypeActive(txTypeNumber) {
        // Assuming txRegistry is accessible within this context
        await loadActivationsList()
        const txType = this.txRegistry[txTypeNumber];
        if (txType && txType.active) {
            return true;
        }
        return false;
    },

    async isSenderGenesisAdmin(address) {
        // Check if the given address is the genesis admin
        return (address === 'tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8')
    },

    isValidJSON(json) {
        try {
            JSON.parse(json);
            return true;
        } catch (e) {
            return false;
        }
    },

    isValidJavaScript(jsCode) {
        // Implement JavaScript validation logic
        // This could include syntax checking and potentially safety checks
        return true; // Placeholder
    }

    minifyJavaScript(jsCode) {
        // Implement JavaScript code minification
        // You might use existing libraries for minification
        return jsCode; // Placeholder
    }

    getNextTxTypeId() {
        // Logic to get the next transaction type ID
        // This might involve querying a database or keeping track in memory
        return /* next transaction type ID */;
    },

    saveNewTransaction(newTx) {
        // Logic to save the new transaction
        // This will likely involve database operations
    }
}

module.exports = Activation;
