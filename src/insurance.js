const db = require('./db.js');
const path = require('path');
const TxUtils = require('./txUtils.js');
const TallyMap = require('./tally.js');

class InsuranceFund {
    static instances = new Map(); // Store instances for each contract

    constructor(contractSeriesId, oracle = false) {
        this.contractSeriesId = contractSeriesId;
        this.balances = []; // { propertyId: '', amountAvailable: 0, amountVesting: 0 }
        this.hedgeRatio = 0.5; // Default 50% hedging
        this.oracle = oracle;
    }

    /** 🔄 Get or create an instance for a given contract ID */
    static async getInstance(contractId, oracle = false) {
        const key = `${contractId}${oracle ? "-oracle" : ""}`;

        if (!this.instances.has(key)) {
            const instance = new InsuranceFund(contractId, oracle);
            await instance.loadFromSnapshot(); // Load data if available
            this.instances.set(key, instance);
        }
        return this.instances.get(key);
    }

    /** 🔄 Load saved snapshot from DB */
    async loadFromSnapshot() {
        let key = this.contractSeriesId.toString();
        if (this.oracle) key += "-oracle";

        const dbInstance = await db.getDatabase("insurance");
        const doc = await dbInstance.findOneAsync({ key });

        if (doc && doc.value) {
            this.balances = doc.value.balances || [];
            this.hedgeRatio = doc.value.hedgeRatio || 0.5;
        }
    }

    /** 💰 Deposit funds into the insurance fund */
    async deposit(propertyId, amount) {
        let propertyFound = false;

        for (const balance of this.balances) {
            if (balance.propertyId === propertyId) {
                balance.amountAvailable += amount;
                propertyFound = true;
                break;
            }
        }

        if (!propertyFound) {
            this.balances.push({ propertyId, amountAvailable: amount });
        }

        await this.recordEvent("deposit", { contractId: this.contractSeriesId, propertyId, amount });
        await this.saveSnapshot();
    }

    /** 💸 Withdraw from the insurance fund */
    async withdraw(amount, propertyId) {
        const balanceEntry = this.balances.find(b => b.propertyId === propertyId);
        if (!balanceEntry || balanceEntry.amountAvailable < amount) {
            throw new Error("Insufficient balance in the insurance fund");
        }
        balanceEntry.amountAvailable -= amount;
        await this.saveSnapshot();
    }

    /** 🚨 Handle deficits (e.g., unexpected losses) */
    async handleDeficit(deficitAmount) {
        await this.recordEvent("deficit", { contractId: this.contractSeriesId, amount: deficitAmount });
        // Adjust hedging strategy if needed (Future expansion)
    }

    /** 💾 Save the insurance fund state */
    async saveSnapshot() {
        let key = `${this.contractSeriesId}${this.oracle ? "-oracle" : ""}`;
        const block = await TxUtils.getBlockCount();
        const snapshot = {
            balances: this.balances,
            contractSeriesId: this.contractSeriesId,
            hedgeRatio: this.hedgeRatio,
            block
        };

        console.log("📌 Saving to insurance fund:", snapshot);
        const dbInstance = await db.getDatabase("insurance");
        await dbInstance.updateAsync({ key }, { $set: { value: snapshot } }, { upsert: true });
    }

    /** 📜 Fetch a stored snapshot */
    async getSnapshot() {
        const dbInstance = await db.getDatabase("insurance");
        const doc = await dbInstance.findOneAsync({ key: this.contractSeriesId.toString() });
        return doc ? doc.value : null;
    }

    /** 📌 Record important events in the insurance fund */
    async recordEvent(eventType, eventData) {
        const eventRecord = {
            type: eventType,
            data: eventData,
            timestamp: new Date().toISOString()
        };

        const dbInstance = await db.getDatabase("insurance");
        await dbInstance.insertAsync({ key: `event-${eventRecord.timestamp}`, value: eventRecord });
    }

    /** 🔥 Liquidate insurance fund to an admin address */
    static async liquidate(adminAddress, contractId, isOracle = false) {
        try {
            const instance = await InsuranceFund.getInstance(contractId, isOracle);
            let key = instance.contractSeriesId.toString();
            if (isOracle) key += "-oracle";

            const snapshot = await instance.getSnapshot();
            if (!snapshot) {
                throw new Error("Insurance fund snapshot not found");
            }

            let totalBalance = snapshot.balances.reduce((sum, b) => sum + b.amountAvailable, 0);
            if (totalBalance === 0) {
                console.log("⚠️ No funds available for liquidation.");
                return;
            }

            const payoutAmount = totalBalance / 2;
            const feeCache = totalBalance / 2;

            console.log(`💰 Half sent to admin (${payoutAmount}), half added to fee cache (${feeCache})`);

            await TallyMap.updateBalance(adminAddress, contractId, payoutAmount, 0, 0, 0, "credit", snapshot.block);
            await InsuranceFund.updateFeeCache(contractId, feeCache);
        } catch (error) {
            console.error(`🚨 Error liquidating insurance fund:`, error);
        }
    }

    /** 📊 Calculate payouts for a range of blocks */
    async getPayouts(contractId, startBlock, endBlock) {
        // Placeholder for payout calculations
    }

    /** 🏦 Calculate required payout from the insurance fund */
    async calcPayout(totalLoss) {
        // Placeholder for future implementation
    }
}

module.exports = InsuranceFund;
