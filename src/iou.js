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
    // NEW: audit helper (same DB)
    // -----------------------
    static async audit(event) {
        const db = await PnlIou._db();

        const doc = {
            _id: `audit:${event.block}:${event.contractId}:${event.propertyId}:${Date.now()}:${Math.random()}`,
            type: 'audit',
            ts: Date.now(),
            ...event
        };

        try {
            await db.insertAsync(doc);
        } catch (e) {
            // audit must never break consensus
            console.warn('IOU audit insert failed:', e.message);
        }
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

        let existing = null;
        try { existing = await db.findOneAsync({ _id: key }); } catch (e) {}

        const current = new BigNumber((existing && existing.amount) || 0);

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
            amount: updated.toString(10),
            lastBlock: block,
            blockStartAmount: blockStart.toString(10),
            blockDelta: nextBlockDelta.toString(10)
        };

        await db.updateAsync({ _id: key }, doc, { upsert: true });

        // -----------------------
        // NEW: audit bucket movement
        // -----------------------
        await PnlIou.audit({
            event: 'bucket_delta',
            block,
            contractId: Number(contractId),
            propertyId: Number(propertyId),
            delta: d.toString(10),
            amountBefore: current.toString(10),
            amountAfter: updated.toString(10),
            blockStartAmount: blockStart.toString(10),
            blockDelta: nextBlockDelta.toString(10)
        });

        return doc;
    }

    static blockReductionTowardZero(doc) {
        const start = new BigNumber((doc && doc.blockStartAmount) || 0);
        const end   = new BigNumber((doc && doc.amount) || 0);

        const reduction = start.abs().minus(end.abs());
        return reduction.gt(0) ? reduction : new BigNumber(0);
    }

    static async applyToLosers(contractId, markDelta, blockHeight, propertyId) {
        let deficit = await this.get(contractId, propertyId);

        if (deficit.gte(0)) return;
        if (markDelta.lte(0)) return;

        const payout = BigNumber.min(markDelta, deficit);
        await this.addDelta(contractId, propertyId, payout, blockHeight);
    }

    static async payOutstandingIous(contractId, propertyId, markDelta, blockHeight) {
        const MarginMap = require('./marginMap.js');
        const mm = await MarginMap.getInstance(contractId);
        const positions = await mm.getAllPositions(contractId);

        let surplus = await this.get(contractId, propertyId);
        if (surplus.lte(0)) return;

        let payout = BigNumber.min(markDelta, surplus);

        const claimants = positions
            .filter(p => p.iouClaim && p.iouClaim.gt(0))
            .map(p => ({ address: p.address, claim: p.iouClaim }));

        if (claimants.length === 0) return;

        const totalClaims = claimants.reduce(
            (acc, c) => acc.plus(c.claim),
            new BigNumber(0)
        );

        payout = BigNumber.min(totalClaims, surplus);

        // -----------------------
        // NEW: payout summary audit
        // -----------------------
        await PnlIou.audit({
            event: 'payout_summary',
            block: blockHeight,
            contractId,
            propertyId,
            payout: payout.toString(10),
            totalClaims: totalClaims.toString(10),
            claimants: claimants.length
        });

        for (let c of claimants) {
            const share = payout.times(c.claim).div(totalClaims);
            const pos = await mm.getPositionForAddress(c.address, contractId);

            const before = new BigNumber(pos.iouClaim || 0);

            pos.realizedPnL = new BigNumber(pos.realizedPnL || 0).plus(share);
            pos.iouClaim = before.minus(share).decimalPlaces(8);
            if (pos.iouClaim.lt(0)) pos.iouClaim = new BigNumber(0);

            await mm.writePositionToMap(contractId, pos);

            // -----------------------
            // NEW: per-address payout audit
            // -----------------------
            await PnlIou.audit({
                event: 'payout_item',
                block: blockHeight,
                contractId,
                propertyId,
                address: c.address,
                paid: share.toString(10),
                claimBefore: before.toString(10),
                claimAfter: pos.iouClaim.toString(10)
            });
        }

        await this.addDelta(contractId, propertyId, payout, blockHeight);
    }

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
    // Get FULL IOU DOC for a (contractId, propertyId)
    // -----------------------
    static async getDoc(contractId, propertyId) {
        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();

        try {
            const doc = await db.findOneAsync({ _id: key });
            return doc || null;
        } catch (err) {
            return null;
        }
    }


    static async getTotalForProperty(propertyId) {
        const db = await PnlIou._db();
        const pId = Number(propertyId);

        let docs;
        try { docs = await db.findAsync({}); }
        catch { return new BigNumber(0); }

        let total = new BigNumber(0);
        for (const doc of docs) {
            if (doc.type !== 'audit' && Number(doc.propertyId) === pId) {
                total = total.plus(doc.amount || 0);
            }
        }
        return total;
    }

    static async delete(contractId, propertyId) {
        const key = PnlIou.key(contractId, propertyId);
        const db = await PnlIou._db();
        await db.removeAsync({ _id: key }, { multi: false });
    }

    static async deleteForProperty(propertyId) {
        const db = await PnlIou._db();
        await db.removeAsync({ propertyId: Number(propertyId) }, { multi: true });
    }
}

module.exports = PnlIou;
