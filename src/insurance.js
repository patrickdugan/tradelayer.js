const db = require('./db.js');
const path = require('path');
const TxUtils = require('./txUtils.js');
const TallyMap = require('./tally.js');
const BigNumber = require('bignumber.js');

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
    async deposit(propertyId, amount,block) {
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

        await this.recordEvent("deposit", { contractId: this.contractSeriesId, propertyId, amount },block);
        await this.saveSnapshot();
    }

    /** 💸 Withdraw from the insurance fund */
    async withdraw(amount, propertyId,block) {
        const balanceEntry = this.balances.find(b => b.propertyId === propertyId);
        if (!balanceEntry || balanceEntry.amountAvailable < amount) {
            throw new Error("Insufficient balance in the insurance fund");
        }
        balanceEntry.amountAvailable -= amount;
        await this.recordEvent("withdraw", { contractId: this.contractSeriesId, propertyId, amount }, block);   
        await this.saveSnapshot();
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
    async recordEvent(eventType, eventData,block) {
        const eventRecord = {
            type: eventType,
            data: eventData,
            timestamp: block
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
  // Get the insurance database instance
  const dbInstance = await db.getDatabase("insurance");

  // Query for all payout events for this contract in the given block range.
  // Assumes events are stored with keys of the form "payout-<contractId>-<block>"
  const query = {
    key: { $regex: `^payout-${contractId}-` },
    "value.block": { $gte: startBlock, $lte: endBlock }
  };

  // Using findAsync which returns an array of documents.
  const docs = await dbInstance.findAsync(query);
  // Map to just the payout event values
  const payouts = docs.map(doc => doc.value);
  return payouts;
}


/** 
 * Calculate required payout from the insurance fund and update the fund accordingly.
 * Debits the fund by the actual payout (which may be less than totalLoss if funds are insufficient),
 * records the payout event under a dedicated key, and saves the updated snapshot.
 *
 * @param {number|string} totalLoss - The total loss amount (negative for losses).
 * @param {number} block - The block number at which the payout is computed.
 */
     async calcPayout(totalLoss, block) {
      // Convert totalLoss to a BigNumber.
      const lossBN = new BigNumber(totalLoss);

      // Calculate the total available funds in the insurance fund.
      let totalAvailable = new BigNumber(0);
      for (const balance of this.balances) {
        totalAvailable = totalAvailable.plus(new BigNumber(balance.amountAvailable));
      }

      // Determine the actual payout amount:
      // If the absolute loss exceeds available funds, pay out only what's available (preserving the sign)
      let payoutAmount;
      if (lossBN.abs().isGreaterThan(totalAvailable)) {
        payoutAmount = totalAvailable;
      } else {
        payoutAmount = lossBN;
      }

      // Debit funds from available balances until the payout is covered.
      let remaining = payoutAmount.abs();
      for (const balance of this.balances) {
        if (remaining.isLessThanOrEqualTo(0)) break;
        const availableBN = new BigNumber(balance.amountAvailable);
        if (availableBN.gt(0)) {
          const debit = BigNumber.minimum(availableBN, remaining);
          // Update the balance with strict 8-decimal precision.
          balance.amountAvailable = availableBN.minus(debit).decimalPlaces(8).toNumber();
          remaining = remaining.minus(debit);
        }
      }
      console.log('payout: '+payoutAmount+' '+payoutAmount.decimalPlaces(8).toNumber())
      if (remaining.gt(0)) {
        // Not enough funds available—this is a deficit.
        console.error(`Insurance fund insufficient: deficit of ${remaining.decimalPlaces(8).toNumber()} tokens`);
        await this.handleDeficit(remaining.decimalPlaces(8).toNumber());
      }

      // Build the payout event record. Note that we include the block and enforce 8‑decimal precision.
      const payoutEvent = {
        type: "payout",
        contractId: this.contractSeriesId,
        block,
        totalLoss: lossBN.decimalPlaces(8).toNumber(),
        payoutAmount: payoutAmount.decimalPlaces(8).toNumber(),
        timestamp: new Date().toISOString()
      };

      // Get the insurance DB instance.
      const dbInstance = await db.getDatabase("insurance");

      // Save the payout event under a dedicated key.
      const payoutKey = `payout-${this.contractSeriesId}-${block}`;
      await dbInstance.insertAsync({ key: payoutKey, value: payoutEvent });

      // Also record the event with the standard recordEvent method.
      await this.recordEvent("payout", {
        contractId: this.contractSeriesId,
        block,
        totalLoss: lossBN.decimalPlaces(8).toNumber(),
        payoutAmount: payoutAmount.decimalPlaces(8).toNumber()
      });

      // Save the updated snapshot to reflect the debited funds.
      await this.saveSnapshot();

      return payoutAmount.decimalPlaces(8).toNumber()

    }

    static async getInsuranceFundBalance(propertyId) {
        const db = await dbInstance.getDatabase('insuranceFund');
        const insuranceEntry = await db.findOneAsync({ _id: propertyId });

        if (insuranceEntry) {
            return new BigNumber(insuranceEntry.amount);
        } else {
            return new BigNumber(0);
        }
    }
}

module.exports = InsuranceFund;
