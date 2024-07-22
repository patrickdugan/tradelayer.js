const db = require('./db.js');
const path = require('path');
const TxUtils = require('./txUtils.js')
const TallyMap = require('./tally.js')

class InsuranceFund {
    constructor(contractSeriesId, balance, hedgeRatio,oracle) {
        this.contractSeriesId = contractSeriesId;
        this.balances = {}; //{propertyId: '',amountAvailable:0,amountVesting:0}
        this.hedgeRatio = 0.5; // 50/50 hedging with the contract
        this.oracle=true
        // Additional properties for hedging strategy
    }

    async deposit(propertyId, amount, vesting) {
        let propertyFound = false;

        for (const balance of this.balances) {
            if (balance.propertyId === propertyId) {
                if (vesting) {
                    balance.amountVesting += amount;
                } else {
                    balance.amountAvailable += amount;
                }
                propertyFound = true;
                break; // Exit loop after updating the existing propertyId
            }
        }

        // If the propertyId was not found in the array, add a new entry
        if (!propertyFound) {
            const newBalance = {
                propertyId: propertyId,
                amountAvailable: vesting ? 0 : amount,
                amountVesting: vesting ? amount : 0
            };
            this.balances.push(newBalance);
        }

        await this.saveSnapshot();
        // Additional logic for hedging strategy (if any)
    }

    async withdraw(amount,propertyId) {
        if (amount > this.balance) {
            throw new Error("Insufficient balance in the insurance fund");
        }
        this.balances[propertyId] -= amount;
        await this.saveSnapshot();
        // Adjust hedging strategy if needed
    }

    async handleDeficit(deficitAmount) {
        // Logic to manage the deficit
        // Record the deficit handling event
        await this.recordEvent('deficit', { amount: deficitAmount });
        // Adjust hedging strategy if needed
    }

    async saveSnapshot() {
        let key = this.contractSeriesId.toString()
        if(this.oracle){
            key+=oracle
        }
        let block = await TxUtils.getBlockCount()
        const snapshot = {
            balances: this.balances,
            contractSeriesId: this.contractSeriesId, // Use a colon here
            hedgeRatio: this.hedgeRatio, // Use a colon here
            block: block
        };
        console.log('saving to insurance fund '+snapshot)
        await new Promise((resolve, reject) => {
            db.getDatabase('insurance').insert({ key: key, value: snapshot }, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    }


    async getSnapshot(key) {
        return new Promise((resolve, reject) => {
            db.getDatabase('insurance').findOne({ key: key }, (err, doc) => {
                if (err) {
                    console.error('Error retrieving snapshot:', err);
                    reject(err);
                } else {
                    resolve(doc ? doc.value : null);
                }
            });
        });
    }

    async recordEvent(eventType, eventData) {
        const eventRecord = {
            type: eventType,
            data: eventData,
            timestamp: new Date().toISOString()
        };
        await new Promise((resolve, reject) => {
            db.getDatabase('insurance').insert({ key: `event-${eventRecord.timestamp}`, value: eventRecord }, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    }

      // New liquidation function
    static async liquidate(adminAddress, isOracle) {
        try {
            const instance = new InsuranceFund();
            let key = instance.contractSeriesId.toString();
            if (isOracle) {
                key += "oracle";
            }
            
            const snapshot = await instance.getSnapshot(key);
            if (!snapshot) {
                throw new Error("Insurance fund snapshot not found");
            }

            let balance = snapshot.balances[propertyId].amountAvailable; // Assuming propertyId is known
            const feeCache = balance / 2;
            const payoutAmount = balance / 2;

            console.log(`Half the balance ${payoutAmount} is sent to admin address ${adminAddress}`);
            console.log(`Half the balance ${feeCache} is put in the fee cache`);

            await TallyMap.updateBalance(adminAddress, propertyId, payoutAmount, 0, 0, 0, "credit", snapshot.block);
            await InsuranceFund.updateFeeCache(propertyId, feeCache);

            console.log(`Liquidation for admin address ${adminAddress} completed`);
        } catch (error) {
            console.error(`Error liquidating insurance fund for admin address ${adminAddress}:`, error);
            throw error;
        }
        return
    }

    async getPayouts(contractId, startBlock, endBlock) {
        // ... Remaining code unchanged ...
    }

    async calcPayout(totalLoss){

    }

    // ... Rest of your class methods ...
}

module.exports = InsuranceFund;
