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
        const BigNumber = require('bignumber.js');

        const d = new BigNumber(delta || 0);
        if (d.isZero()) return null;

        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();

        let existing = null;
        try { existing = await db.findOneAsync({ _id: key }); } catch (e) {}

        const current = new BigNumber((existing && existing.amount) || 0);

        // If we’re entering a new block, snapshot start-of-block.
        // If same block, keep prior snapshot and keep accumulating blockDelta.
        const isNewBlock = !(existing && Number(existing.lastBlock) === Number(block));

        const blockStart = isNewBlock
            ? current
            : new BigNumber((existing && existing.blockStartAmount) || current);

        const prevBlockDelta = isNewBlock
            ? new BigNumber(0)
            : new BigNumber((existing && existing.blockDelta) || 0);

        const nextBlockDelta = prevBlockDelta.plus(d);
        const updated = current.plus(d);

        const doc = {
            _id: key,
            contractId: Number(contractId),
            propertyId: Number(propertyId),

            // signed running “net bucket”
            amount: updated.toString(10),

            // per-block tracking
            lastBlock: block,
            blockStartAmount: blockStart.toString(10),
            blockDelta: nextBlockDelta.toString(10)
        };

        await db.updateAsync({ _id: key }, doc, { upsert: true });
        return doc;
    }

    static blockReductionTowardZero(doc) {
        const BigNumber = require('bignumber.js');
        const start = new BigNumber((doc && doc.blockStartAmount) || 0);
        const end   = new BigNumber((doc && doc.amount) || 0);

        const reduction = start.abs().minus(end.abs());
        return reduction.gt(0) ? reduction : new BigNumber(0);
    }



    static async applyToLosers(
        contractId,
        markDelta,         // BigNumber (positive)
        blockHeight,
        propertyId
    ) {
        const MarginMap = require('./marginMap.js');
        const mm = await MarginMap.getInstance(contractId);

        let deficit = await this.get(contractId,propertyId);

        if (deficit.gte(0)) return;      // nothing to distribute
        if (markDelta.lte(0)) return;    // no unfunded profit this block

        // Max we can distribute
        const payout = BigNumber.min(markDelta, deficit);

        await this.addDelta(contractId, propertyId, payout, blockHeight);
    };

    static async payOutstandingIous(contractId, propertyId,markDelta, blockHeight) {
        const MarginMap = require('./marginMap.js');
        const mm = await MarginMap.getInstance(contractId);
        const positions = await mm.getAllPositions(contractId);

        let surplus = await this.get(contractId,propertyId);

        if (surplus.lte(0)) return;

        let payout = BigNumber.min(markDelta, surplus);

        // Collect claimants
        const claimants = positions
            .filter(p => p.iouClaim && p.iouClaim.gt(0))
            .map(p => ({ address: p.address, claim: p.iouClaim }));

        if (claimants.length === 0) return;

        const totalClaims = claimants.reduce(
            (acc, c) => acc.plus(c.claim),
            new BigNumber(0)
        );

        // Distribute pro-rata
        payout = BigNumber.min(totalClaims, surplus);

        for (let c of claimants) {
            const share = payout.times(c.claim).div(totalClaims);
            const pos = await mm.getPositionForAddress(c.address, contractId);

            pos.realizedPnL = new BigNumber(pos.realizedPnL || 0).plus(share);
            pos.iouClaim = pos.iouClaim.minus(share).decimalPlaces(8);

            if (pos.iouClaim.lt(0)) pos.iouClaim = new BigNumber(0);

            await mm.writePositionToMap(contractId, pos);
        }

        await this.addDelta(contractId, propertyId, payout, blockHeight);
    };

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
    static async delete(contractId, propertyId) {
        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();
        await db.removeAsync({ _id: key }, { multi: false });
    }

    // -----------------------
    // OPTIONAL: Clear all IOUs for a property
    // -----------------------
    static async deleteForProperty(propertyId) {
        const db = await PnlIou._db();
        await db.removeAsync({ propertyId: Number(propertyId) }, { multi: true });
    }
}

module.exports = PnlIou;
