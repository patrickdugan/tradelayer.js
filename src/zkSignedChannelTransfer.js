'use strict';

const crypto = require('crypto');
const BigNumber = require('bignumber.js');
const secp = require('tiny-secp256k1');
const ZkConsensus = require('./zkConsensusEnvelope.js');

const SIGNED_CHANNEL_TRANSFER_PROTOCOL = 'tl_zk_signed_channel_transfer_batch_v1';
const SIGNED_CHANNEL_TRANSFER_MESSAGE = 'tl_zk_signed_channel_transfer_v1';

function sha256Buffer(value) {
    return crypto.createHash('sha256').update(value).digest();
}

function normalizeColumn(value, fieldName) {
    const column = String(value || '').toUpperCase();
    if (column !== 'A' && column !== 'B') throw new Error(`${fieldName} must be A or B`);
    return column;
}

function normalizeAmountUnits(value, fieldName = 'amountUnits') {
    const text = String(value ?? '').trim();
    if (!/^[0-9]+$/.test(text)) throw new Error(`${fieldName} must be a positive integer string`);
    const amount = BigInt(text);
    if (amount <= 0n) throw new Error(`${fieldName} must be positive`);
    return amount.toString();
}

function tokenUnitsToAmount(amountUnits) {
    return new BigNumber(String(amountUnits)).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN);
}

function normalizePubkeyHex(value, fieldName = 'pubkeyHex') {
    const text = String(value || '').trim().toLowerCase();
    if (!/^[0-9a-f]{66}$/.test(text) && !/^[0-9a-f]{130}$/.test(text)) {
        throw new Error(`${fieldName} must be a compressed or uncompressed secp256k1 pubkey hex`);
    }
    return text;
}

function normalizeSignatureHex(value, fieldName = 'signatureHex') {
    const text = String(value || '').trim().toLowerCase();
    if (!/^[0-9a-f]{128}$/.test(text)) {
        throw new Error(`${fieldName} must be a 64-byte compact secp256k1 signature hex`);
    }
    return text;
}

function normalizeTransferCore(transfer = {}, index = 0) {
    const propertyId = Number(transfer.propertyId);
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`transfer ${index} has invalid propertyId`);
    }

    const core = {
        protocol: SIGNED_CHANNEL_TRANSFER_MESSAGE,
        fromChannelAddress: String(transfer.fromChannelAddress || ''),
        toChannelAddress: String(transfer.toChannelAddress || ''),
        sourceColumn: normalizeColumn(transfer.sourceColumn, `transfer ${index} sourceColumn`),
        destinationColumn: normalizeColumn(transfer.destinationColumn || transfer.sourceColumn, `transfer ${index} destinationColumn`),
        ownerAddress: String(transfer.ownerAddress || ''),
        propertyId,
        amountUnits: normalizeAmountUnits(transfer.amountUnits, `transfer ${index} amountUnits`),
        nonce: String(transfer.nonce || '')
    };

    if (!core.fromChannelAddress || !core.toChannelAddress || core.fromChannelAddress === core.toChannelAddress) {
        throw new Error(`transfer ${index} must have distinct source and destination channels`);
    }
    if (!core.ownerAddress) throw new Error(`transfer ${index} ownerAddress is required`);
    return core;
}

function transferMessageHash(core) {
    return sha256Buffer(Buffer.from(ZkConsensus.canonicalStringify(core), 'utf8'));
}

function transferIdForCore(core, authorizedPubkeys = []) {
    return ZkConsensus.hashCanonical({
        protocol: SIGNED_CHANNEL_TRANSFER_MESSAGE,
        core,
        authorizedPubkeys: authorizedPubkeys.map((pubkey) => String(pubkey).toLowerCase()).sort()
    });
}

function normalizeSignedTransfer(transfer = {}, index = 0) {
    const core = normalizeTransferCore(transfer.core || transfer, index);
    const authorizedPubkeys = (transfer.authorizedPubkeys || transfer.authorization?.authorizedPubkeys || [])
        .map((pubkey, keyIndex) => normalizePubkeyHex(pubkey, `transfer ${index} authorizedPubkeys[${keyIndex}]`))
        .sort();
    if (authorizedPubkeys.length < 2) {
        throw new Error(`transfer ${index} requires at least two authorized pubkeys`);
    }
    const signatures = (transfer.signatures || []).map((signature, sigIndex) => ({
        role: String(signature.role || `sig-${sigIndex}`),
        pubkeyHex: normalizePubkeyHex(signature.pubkeyHex, `transfer ${index} signatures[${sigIndex}].pubkeyHex`),
        signatureHex: normalizeSignatureHex(signature.signatureHex, `transfer ${index} signatures[${sigIndex}].signatureHex`)
    })).sort((a, b) => a.pubkeyHex.localeCompare(b.pubkeyHex));

    const transferId = transferIdForCore(core, authorizedPubkeys);
    return {
        kind: 'tl_zk_signed_channel_transfer',
        transferId,
        core,
        authorization: {
            scheme: 'secp256k1-compact-2-of-2',
            requiredSignatures: 2,
            authorizedPubkeys
        },
        signatures
    };
}

function verifySignedTransfer(transfer = {}, index = 0) {
    try {
        const normalized = normalizeSignedTransfer(transfer, index);
        if (transfer.transferId && String(transfer.transferId) !== normalized.transferId) {
            return { ok: false, reason: `transfer ${index} id mismatch` };
        }

        const digest = transferMessageHash(normalized.core);
        const validPubkeys = new Set();
        for (const signature of normalized.signatures) {
            if (!normalized.authorization.authorizedPubkeys.includes(signature.pubkeyHex)) continue;
            const ok = secp.verify(
                digest,
                Buffer.from(signature.pubkeyHex, 'hex'),
                Buffer.from(signature.signatureHex, 'hex')
            );
            if (ok) validPubkeys.add(signature.pubkeyHex);
        }
        if (validPubkeys.size < normalized.authorization.requiredSignatures) {
            return { ok: false, reason: `transfer ${index} missing required signatures` };
        }

        return { ok: true, transfer: normalized };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

function normalizeSignedChannelTransferBatch(batch = {}) {
    if (!batch || batch.kind !== SIGNED_CHANNEL_TRANSFER_PROTOCOL) {
        throw new Error('wrong signed channel transfer batch kind');
    }
    const rawTransfers = Array.isArray(batch.transfers) ? batch.transfers : (batch.batchCore?.transfers || []);
    const transfers = rawTransfers.map((transfer, index) => {
        const checked = verifySignedTransfer(transfer, index);
        if (!checked.ok) throw new Error(checked.reason);
        return checked.transfer;
    });
    if (transfers.length === 0) throw new Error('signed channel transfer batch is empty');

    const batchCore = {
        protocol: SIGNED_CHANNEL_TRANSFER_PROTOCOL,
        nonce: String(batch.batchCore?.nonce || batch.nonce || ''),
        transfers,
        transferRoot: ZkConsensus.hashCanonical(transfers.map((transfer) => transfer.transferId)),
        signatureRoot: ZkConsensus.hashCanonical(transfers.map((transfer) => ({
            transferId: transfer.transferId,
            signatures: transfer.signatures
        })))
    };

    return {
        kind: SIGNED_CHANNEL_TRANSFER_PROTOCOL,
        batchId: ZkConsensus.hashCanonical(batchCore),
        batchCore
    };
}

function verifySignedChannelTransferBatch(batch = {}) {
    try {
        const normalized = normalizeSignedChannelTransferBatch(batch);
        if (batch.batchId && String(batch.batchId) !== normalized.batchId) {
            return { ok: false, reason: 'signed channel transfer batch id mismatch' };
        }
        return { ok: true, batch: normalized };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

function extractSignedChannelTransferBatch(envelope = {}) {
    const value = envelope?.envelopeCore?.daBlob?.value;
    if (!value || typeof value !== 'object') return null;
    return value.signedChannelTransferBatch || value.channelTransferBatch || null;
}

function assertEnvelopeBindsBatch(envelope = {}, batch = {}) {
    const normalized = normalizeSignedChannelTransferBatch(batch);
    const batchHash = ZkConsensus.hashCanonical(normalized);
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    if (publicInputs.signedChannelTransferBatchHash && publicInputs.signedChannelTransferBatchHash !== batchHash) {
        throw new Error('signed channel transfer batch hash mismatch');
    }
    if (publicInputs.channelSignatureRoot && publicInputs.channelSignatureRoot !== normalized.batchCore.signatureRoot) {
        throw new Error('signed channel transfer signature root mismatch');
    }
    return { normalized, batchHash };
}

async function applySignedChannelTransferBatch(batch = {}, { block = 0, txid = '' } = {}) {
    const Channels = require('./channels.js');
    const checked = verifySignedChannelTransferBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);

    const applied = [];
    for (const transfer of checked.batch.batchCore.transfers) {
        const core = transfer.core;
        const amount = tokenUnitsToAmount(core.amountUnits);
        const source = await Channels.getChannel(core.fromChannelAddress);
        if (!source) throw new Error(`source channel ${core.fromChannelAddress} not found`);

        const destination = await Channels.getChannel(core.toChannelAddress) || {
            channel: core.toChannelAddress,
            participants: { A: '', B: '' },
            A: {},
            B: {},
            commits: []
        };
        source.participants = source.participants || { A: '', B: '' };
        destination.participants = destination.participants || { A: '', B: '' };
        source[core.sourceColumn] = source[core.sourceColumn] || {};
        destination[core.destinationColumn] = destination[core.destinationColumn] || {};

        const sourceBalance = new BigNumber(source[core.sourceColumn][core.propertyId] || 0);
        if (sourceBalance.lt(amount)) {
            throw new Error(`insufficient source channel balance ${sourceBalance.toString()} < ${amount.toString()}`);
        }

        source[core.sourceColumn][core.propertyId] = sourceBalance.minus(amount).decimalPlaces(8).toNumber();
        destination[core.destinationColumn][core.propertyId] = new BigNumber(destination[core.destinationColumn][core.propertyId] || 0)
            .plus(amount)
            .decimalPlaces(8)
            .toNumber();
        if (!destination.participants[core.destinationColumn]) {
            destination.participants[core.destinationColumn] = core.ownerAddress;
        }

        await Channels.setChannel(core.fromChannelAddress, source);
        await Channels.setChannel(core.toChannelAddress, destination);
        await Channels.recordChannelDelta({
            channelId: core.fromChannelAddress,
            column: core.sourceColumn,
            propertyId: core.propertyId,
            amount: amount.negated().toNumber(),
            type: 'zkSignedChannelTransferDebit',
            participant: core.ownerAddress,
            block,
            txid,
            memo: checked.batch.batchId
        });
        await Channels.recordChannelDelta({
            channelId: core.toChannelAddress,
            column: core.destinationColumn,
            propertyId: core.propertyId,
            amount: amount.toNumber(),
            type: 'zkSignedChannelTransferCredit',
            participant: core.ownerAddress,
            block,
            txid,
            memo: checked.batch.batchId
        });

        applied.push({
            transferId: transfer.transferId,
            fromChannelAddress: core.fromChannelAddress,
            toChannelAddress: core.toChannelAddress,
            sourceColumn: core.sourceColumn,
            destinationColumn: core.destinationColumn,
            propertyId: core.propertyId,
            amount: amount.toString(),
            amountUnits: core.amountUnits
        });
    }

    return {
        ok: true,
        batchId: checked.batch.batchId,
        transferRoot: checked.batch.batchCore.transferRoot,
        signatureRoot: checked.batch.batchCore.signatureRoot,
        applied
    };
}

module.exports = {
    SIGNED_CHANNEL_TRANSFER_PROTOCOL,
    SIGNED_CHANNEL_TRANSFER_MESSAGE,
    normalizeTransferCore,
    transferMessageHash,
    transferIdForCore,
    normalizeSignedTransfer,
    verifySignedTransfer,
    normalizeSignedChannelTransferBatch,
    verifySignedChannelTransferBatch,
    extractSignedChannelTransferBatch,
    assertEnvelopeBindsBatch,
    applySignedChannelTransferBatch,
    tokenUnitsToAmount
};
