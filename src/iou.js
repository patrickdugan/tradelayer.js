// pnlIou.js
//
// STATIC IOU BUCKET
// Records PnL mismatch or loss shortfalls per (contractId, propertyId).
// No instance state. No RAM caching.
// Compatible with NeDB or Mongo via your db.js wrapper.

const BigNumber = require('bignumber.js');
const dbInstance = require('./db.js');

class PnlIou {
    // -----------------------
    // Helpers
    // -----------------------
    static key(contractId, propertyId) {
        return `${contractId}:${propertyId}`;
    }

    static async _db() {
        return await dbInstance.getDatabase('iou');
    }

    // -----------------------
    // Add ∆IOU
    // delta > 0 → system owes traders
    // delta < 0 → traders owe system
    // -----------------------
    static async addDelta(contractId, propertyId, delta, block) {
        const d = new BigNumber(delta || 0);
        if (d.isZero()) return null;

        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();

        let existing;
        try {
            existing = await db.findOneAsync({ _id: key });
        } catch (err) {
            existing = null;
        }

        const current = new BigNumber(existing && existing.amount || 0);
        const updated = current.plus(d);

        const doc = {
            _id: key,
            contractId: Number(contractId),
            propertyId: Number(propertyId),
            amount: updated.toString(10),
            lastBlock: block
        };

        await db.updateAsync({ _id: key }, doc, { upsert: true });
        return doc;
    }

    // -----------------------
    // Get IOU for a (contractId, propertyId)
    // -----------------------
    static async get(contractId, propertyId) {
        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();

        try {
            const doc = await db.findOneAsync({ _id: key });
            if (!doc) return new BigNumber(0);
            return new BigNumber(doc.amount);
        } catch (err) {
            return new BigNumber(0);
        }
    }

    // -----------------------
    // Get TOTAL IOU for an entire property (summing across all contractIds)
    // -----------------------
    static async getTotalForProperty(propertyId) {
        const db = await PnlIou._db();
        const pId = Number(propertyId);

        let docs;
        try {
            docs = await db.findAsync({});
        } catch (err) {
            return new BigNumber(0);
        }

        let total = new BigNumber(0);
        for (const doc of docs) {
            if (Number(doc.propertyId) === pId) {
                total = total.plus(doc.amount || 0);
            }
        }
        return total;
    }

    // -----------------------
    // Clear one contract / property pair
    // -----------------------
    static async clear(contractId, propertyId) {
        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();
        await db.removeAsync({ _id: key }, { multi: false });
    }

    // -----------------------
    // OPTIONAL: Clear all IOUs for a property
    // -----------------------
    static async clearForProperty(propertyId) {
        const db = await PnlIou._db();
        await db.removeAsync({ propertyId: Number(propertyId) }, { multi: true });
    }
}

module.exports = PnlIou;
