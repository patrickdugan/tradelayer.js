const crypto = require('crypto');
const db = require('./db');

const CACHE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CHALLENGED: 'CHALLENGED',
  RELEASED: 'RELEASED',
  RESOLVED_UPHELD: 'RESOLVED_UPHELD'
});

class BitvmCacheRegistry {
  static async _base() {
    return db.getDatabase('procedural');
  }

  static _challengeBlocks(raw) {
    const fallback = Number(process.env.TL_BITVM_CHALLENGE_BLOCKS || 6);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return Math.max(0, fallback);
    return Math.floor(n);
  }

  static buildCacheId(parts = {}) {
    if (parts.cacheId) return String(parts.cacheId);
    const raw = JSON.stringify({
      dlcRef: parts.dlcRef || '',
      stateHash: parts.stateHash || '',
      bundleHash: parts.bundleHash || '',
      propertyId: Number(parts.propertyId || 0),
      amount: Number(parts.amount || 0),
      fromAddress: parts.fromAddress || '',
      toAddress: parts.toAddress || '',
      cacheAddress: parts.cacheAddress || ''
    });
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  static async get(cacheId) {
    const base = await this._base();
    return base.findOneAsync({ _id: `bitvm-cache-${cacheId}` });
  }

  static async open(settlement, context = {}) {
    const propertyId = Number(settlement.propertyId);
    const amount = Number(settlement.amount || 0);
    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      throw new Error('Invalid bitvm cache propertyId');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Invalid bitvm cache amount');
    }

    const fromAddress = settlement.fromAddress || settlement.holderAddress || context.senderAddress || '';
    const toAddress = settlement.toAddress || settlement.recipientAddress || context.senderAddress || '';
    const cacheAddress = settlement.cacheAddress || `BITVM_CACHE::${context.dlcRef || context.stateHash || 'default'}`;
    const challengeBlocks = this._challengeBlocks(settlement.challengeBlocks);
    const cacheId = this.buildCacheId({
      cacheId: settlement.cacheId,
      dlcRef: context.dlcRef,
      stateHash: context.stateHash,
      bundleHash: settlement.bundleHash || '',
      propertyId,
      amount,
      fromAddress,
      toAddress,
      cacheAddress
    });

    const base = await this._base();
    const key = `bitvm-cache-${cacheId}`;
    const existing = await base.findOneAsync({ _id: key });
    if (existing && existing.status !== CACHE_STATUS.RELEASED) {
      throw new Error(`BitVM cache already pending/challenged: ${cacheId}`);
    }

    const createdBlock = Number(context.block || 0);
    const doc = {
      _id: key,
      type: 'bitvmCache',
      cacheId,
      status: CACHE_STATUS.PENDING,
      createdBlock,
      challengeDeadlineBlock: createdBlock + challengeBlocks,
      challengeBlocks,
      dlcRef: context.dlcRef || '',
      stateHash: context.stateHash || '',
      bundleHash: settlement.bundleHash || '',
      fromAddress,
      toAddress,
      cacheAddress,
      propertyId,
      amount,
      challenged: [],
      releasedAtBlock: null,
      createdAt: Date.now()
    };
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async challenge(cacheId, detail = {}) {
    const base = await this._base();
    const key = `bitvm-cache-${cacheId}`;
    const doc = await base.findOneAsync({ _id: key });
    if (!doc) throw new Error(`Unknown BitVM cacheId: ${cacheId}`);
    if (doc.status === CACHE_STATUS.RELEASED) {
      throw new Error(`BitVM cache already released: ${cacheId}`);
    }

    const challenged = Array.isArray(doc.challenged) ? doc.challenged.slice() : [];
    challenged.push({
      challengerAddress: detail.challengerAddress || '',
      evidenceHash: detail.evidenceHash || '',
      reason: detail.reason || '',
      block: Number(detail.block || 0),
      ts: Date.now()
    });

    doc.status = CACHE_STATUS.CHALLENGED;
    doc.challenged = challenged;
    doc.lastChallengeBlock = Number(detail.block || 0);
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async finalize(cacheId, detail = {}) {
    const base = await this._base();
    const key = `bitvm-cache-${cacheId}`;
    const doc = await base.findOneAsync({ _id: key });
    if (!doc) throw new Error(`Unknown BitVM cacheId: ${cacheId}`);
    if (doc.status === CACHE_STATUS.CHALLENGED) {
      throw new Error(`BitVM cache challenged; payout blocked for ${cacheId}`);
    }
    if (doc.status === CACHE_STATUS.RESOLVED_UPHELD) {
      throw new Error(`BitVM cache challenge upheld; payout blocked for ${cacheId}`);
    }
    if (doc.status === CACHE_STATUS.RELEASED) {
      throw new Error(`BitVM cache already released: ${cacheId}`);
    }

    const atBlock = Number(detail.block || 0);
    if (!Number.isFinite(atBlock) || atBlock < Number(doc.challengeDeadlineBlock || 0)) {
      throw new Error(
        `BitVM challenge window still open for ${cacheId} (deadline ${doc.challengeDeadlineBlock}, block ${atBlock})`
      );
    }

    const payoutTo = detail.toAddress || doc.toAddress;
    const payoutAmount = Number(detail.amount || doc.amount || 0);
    const payoutPropertyId = Number(detail.propertyId || doc.propertyId || 0);
    if (payoutTo !== doc.toAddress) {
      throw new Error(`BitVM payout recipient mismatch for ${cacheId}`);
    }
    if (payoutAmount !== Number(doc.amount)) {
      throw new Error(`BitVM payout amount mismatch for ${cacheId}`);
    }
    if (payoutPropertyId !== Number(doc.propertyId)) {
      throw new Error(`BitVM payout property mismatch for ${cacheId}`);
    }

    doc.status = CACHE_STATUS.RELEASED;
    doc.releasedAtBlock = atBlock;
    doc.releaseTxid = detail.txid || '';
    doc.updatedAt = Date.now();
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async resolve(cacheId, detail = {}) {
    const base = await this._base();
    const key = `bitvm-cache-${cacheId}`;
    const doc = await base.findOneAsync({ _id: key });
    if (!doc) throw new Error(`Unknown BitVM cacheId: ${cacheId}`);
    if (doc.status === CACHE_STATUS.RELEASED) {
      throw new Error(`BitVM cache already released: ${cacheId}`);
    }

    const verdict = String(detail.verdict || '').toLowerCase();
    if (!['uphold', 'reject'].includes(verdict)) {
      throw new Error('bitvm_resolve requires verdict=uphold|reject');
    }

    const atBlock = Number(detail.block || 0);
    if (verdict === 'uphold') {
      doc.status = CACHE_STATUS.RESOLVED_UPHELD;
      doc.resolution = {
        verdict: 'uphold',
        resolverAddress: detail.resolverAddress || '',
        reason: detail.reason || '',
        block: atBlock,
        ts: Date.now()
      };
      await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
      return doc;
    }

    // reject challenge => restore payout path
    doc.status = CACHE_STATUS.PENDING;
    doc.challengeDeadlineBlock = Math.min(
      Number(doc.challengeDeadlineBlock || atBlock),
      atBlock
    );
    doc.resolution = {
      verdict: 'reject',
      resolverAddress: detail.resolverAddress || '',
      reason: detail.reason || '',
      block: atBlock,
      ts: Date.now()
    };
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }
}

module.exports = { BitvmCacheRegistry, CACHE_STATUS };
