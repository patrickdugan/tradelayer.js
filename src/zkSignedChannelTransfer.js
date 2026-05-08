'use strict';

const crypto = require('crypto');
const BigNumber = require('bignumber.js');
const secp = require('tiny-secp256k1');
const ZkConsensus = require('./zkConsensusEnvelope.js');

const SIGNED_CHANNEL_TRANSFER_PROTOCOL = 'tl_zk_signed_channel_transfer_batch_v1';
const SIGNED_CHANNEL_TRANSFER_MESSAGE = 'tl_zk_signed_channel_transfer_v1';
const SIGNED_CHANNEL_TRANSFER_EXECUTION_PROTOCOL = 'tl_zk_signed_channel_transfer_execution_v1';

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

function normalizeBalanceUnits(value, fieldName = 'balanceUnits') {
    const text = String(value ?? '').trim();
    if (!/^[0-9]+$/.test(text)) throw new Error(`${fieldName} must be a non-negative integer string`);
    return BigInt(text).toString();
}

function tokenUnitsToAmount(amountUnits) {
    return new BigNumber(String(amountUnits)).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN);
}

function amountValueToUnits(value, fieldName = 'balance') {
    const amount = new BigNumber(String(value ?? 0));
    if (!amount.isFinite() || amount.lt(0)) throw new Error(`${fieldName} must be a non-negative finite amount`);
    return amount.times(1e8).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
}

function balanceKey(channelAddress, column, propertyId) {
    return `${channelAddress}:${column}:${propertyId}`;
}

function parseBalanceKey(key) {
    const parts = String(key).split(':');
    if (parts.length < 3) throw new Error(`invalid balance key ${key}`);
    const propertyId = Number(parts.pop());
    const column = normalizeColumn(parts.pop(), `balance key ${key} column`);
    const channelAddress = parts.join(':');
    if (!channelAddress || !Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`invalid balance key ${key}`);
    }
    return { channelAddress, column, propertyId };
}

function channelBalanceUnits(channel = {}, column, propertyId) {
    return amountValueToUnits(channel?.[column]?.[propertyId] || 0, `${channel?.channel || 'channel'}:${column}:${propertyId}`);
}

function normalizeBalanceRow(row = {}, index = 0) {
    const propertyId = Number(row.propertyId);
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`balance row ${index} has invalid propertyId`);
    }
    const channelAddress = String(row.channelAddress || row.channel || '');
    if (!channelAddress) throw new Error(`balance row ${index} channelAddress is required`);
    const column = normalizeColumn(row.column, `balance row ${index} column`);
    const balanceUnits = normalizeBalanceUnits(row.balanceUnits, `balance row ${index} balanceUnits`);
    return {
        channelAddress,
        column,
        propertyId,
        balanceUnits,
        key: balanceKey(channelAddress, column, propertyId)
    };
}

function normalizeBalanceRows(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('execution witness requires balance rows');
    const seen = new Set();
    return rows.map((row, index) => normalizeBalanceRow(row, index))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((row) => {
            if (seen.has(row.key)) throw new Error(`duplicate balance row ${row.key}`);
            seen.add(row.key);
            return row;
        });
}

function touchedBalanceKeys(transfers = []) {
    const keys = new Set();
    for (const transfer of transfers) {
        const core = transfer.core;
        keys.add(balanceKey(core.fromChannelAddress, core.sourceColumn, core.propertyId));
        keys.add(balanceKey(core.toChannelAddress, core.destinationColumn, core.propertyId));
    }
    return [...keys].sort();
}

function inputRowsFromChannels(batch = {}, channels = {}) {
    const checked = verifySignedChannelTransferBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    return touchedBalanceKeys(checked.batch.batchCore.transfers).map((key) => {
        const parsed = parseBalanceKey(key);
        const channel = channels[parsed.channelAddress] || {};
        return {
            ...parsed,
            balanceUnits: channelBalanceUnits(channel, parsed.column, parsed.propertyId),
            key
        };
    });
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

function buildSignedChannelTransferExecution(batch = {}, inputRowsOrChannels = {}) {
    const checked = verifySignedChannelTransferBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);

    const inputRows = Array.isArray(inputRowsOrChannels)
        ? normalizeBalanceRows(inputRowsOrChannels)
        : normalizeBalanceRows(inputRowsFromChannels(checked.batch, inputRowsOrChannels));
    const balances = new Map(inputRows.map((row) => [row.key, BigInt(row.balanceUnits)]));
    const transferExecutions = [];
    const authorizationChecks = [];
    const totals = new Map();

    for (const transfer of checked.batch.batchCore.transfers) {
        const core = transfer.core;
        const sourceKey = balanceKey(core.fromChannelAddress, core.sourceColumn, core.propertyId);
        const destinationKey = balanceKey(core.toChannelAddress, core.destinationColumn, core.propertyId);
        if (!balances.has(sourceKey)) throw new Error(`execution input row missing ${sourceKey}`);
        if (!balances.has(destinationKey)) throw new Error(`execution input row missing ${destinationKey}`);

        const amountUnits = BigInt(core.amountUnits);
        const sourceBefore = balances.get(sourceKey);
        const destinationBefore = balances.get(destinationKey);
        if (sourceBefore < amountUnits) {
            throw new Error(`execution source balance ${sourceKey} is insufficient`);
        }

        const sourceAfter = sourceBefore - amountUnits;
        const destinationAfter = destinationBefore + amountUnits;
        balances.set(sourceKey, sourceAfter);
        balances.set(destinationKey, destinationAfter);

        const total = totals.get(core.propertyId) || { propertyId: core.propertyId, debitUnits: 0n, creditUnits: 0n };
        total.debitUnits += amountUnits;
        total.creditUnits += amountUnits;
        totals.set(core.propertyId, total);

        transferExecutions.push({
            transferId: transfer.transferId,
            propertyId: core.propertyId,
            amountUnits: core.amountUnits,
            source: {
                channelAddress: core.fromChannelAddress,
                column: core.sourceColumn,
                key: sourceKey,
                beforeUnits: sourceBefore.toString(),
                afterUnits: sourceAfter.toString()
            },
            destination: {
                channelAddress: core.toChannelAddress,
                column: core.destinationColumn,
                key: destinationKey,
                beforeUnits: destinationBefore.toString(),
                afterUnits: destinationAfter.toString()
            }
        });

        authorizationChecks.push({
            transferId: transfer.transferId,
            scheme: transfer.authorization.scheme,
            requiredSignatures: transfer.authorization.requiredSignatures,
            authorizedPubkeys: transfer.authorization.authorizedPubkeys,
            signerPubkeys: transfer.signatures.map((signature) => signature.pubkeyHex).sort(),
            messageHash: transferMessageHash(core).toString('hex')
        });
    }

    const outputRows = inputRows.map((row) => ({
        ...row,
        balanceUnits: balances.get(row.key).toString()
    })).sort((a, b) => a.key.localeCompare(b.key));
    const conservationRows = [...totals.values()]
        .map((row) => ({
            propertyId: row.propertyId,
            totalDebitUnits: row.debitUnits.toString(),
            totalCreditUnits: row.creditUnits.toString(),
            conserved: row.debitUnits === row.creditUnits
        }))
        .sort((a, b) => a.propertyId - b.propertyId);
    if (conservationRows.some((row) => !row.conserved)) {
        throw new Error('execution witness is not value conserving');
    }

    const executionCore = {
        protocol: SIGNED_CHANNEL_TRANSFER_EXECUTION_PROTOCOL,
        batchId: checked.batch.batchId,
        batchHash: ZkConsensus.hashCanonical(checked.batch),
        inputStateRoot: ZkConsensus.hashCanonical(inputRows),
        outputStateRoot: ZkConsensus.hashCanonical(outputRows),
        balanceTransitionRoot: ZkConsensus.hashCanonical(transferExecutions),
        authorizationRoot: ZkConsensus.hashCanonical(authorizationChecks),
        conservationRoot: ZkConsensus.hashCanonical(conservationRows),
        transferCount: transferExecutions.length
    };
    executionCore.executionId = ZkConsensus.hashCanonical(executionCore);

    return {
        kind: SIGNED_CHANNEL_TRANSFER_EXECUTION_PROTOCOL,
        executionCore,
        inputRows,
        outputRows,
        transferExecutions,
        authorizationChecks,
        conservationRows
    };
}

function normalizeSignedChannelTransferExecution(batch = {}, execution = {}) {
    if (!execution || execution.kind !== SIGNED_CHANNEL_TRANSFER_EXECUTION_PROTOCOL) {
        throw new Error('wrong signed channel transfer execution kind');
    }
    const rebuilt = buildSignedChannelTransferExecution(batch, execution.inputRows || []);
    const expected = ZkConsensus.hashCanonical(rebuilt);
    const observed = ZkConsensus.hashCanonical(execution);
    if (observed !== expected) {
        throw new Error('signed channel transfer execution witness mismatch');
    }
    if (execution.executionCore?.executionId !== rebuilt.executionCore.executionId) {
        throw new Error('signed channel transfer execution id mismatch');
    }
    return rebuilt;
}

function verifySignedChannelTransferExecution(batch = {}, execution = {}) {
    try {
        return { ok: true, execution: normalizeSignedChannelTransferExecution(batch, execution) };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

function extractSignedChannelTransferBatch(envelope = {}) {
    const value = envelope?.envelopeCore?.daBlob?.value;
    if (!value || typeof value !== 'object') return null;
    return value.signedChannelTransferBatch || value.channelTransferBatch || null;
}

function extractSignedChannelTransferExecution(envelope = {}) {
    const value = envelope?.envelopeCore?.daBlob?.value;
    if (!value || typeof value !== 'object') return null;
    return value.signedChannelTransferExecution || value.channelTransferExecution || null;
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

function assertEnvelopeBindsExecution(envelope = {}, batch = {}, execution = null) {
    const normalizedExecution = normalizeSignedChannelTransferExecution(batch, execution || extractSignedChannelTransferExecution(envelope));
    const executionHash = ZkConsensus.hashCanonical(normalizedExecution);
    const core = normalizedExecution.executionCore;
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    const expectedFields = {
        signedChannelTransferExecutionHash: executionHash,
        channelInputStateRoot: core.inputStateRoot,
        channelOutputStateRoot: core.outputStateRoot,
        channelBalanceTransitionRoot: core.balanceTransitionRoot,
        channelAuthorizationRoot: core.authorizationRoot,
        channelConservationRoot: core.conservationRoot
    };
    for (const [field, expected] of Object.entries(expectedFields)) {
        if (publicInputs[field] && publicInputs[field] !== expected) {
            throw new Error(`${field} mismatch`);
        }
    }
    return { normalized: normalizedExecution, executionHash };
}

async function applySignedChannelTransferBatch(batch = {}, { block = 0, txid = '', execution = null } = {}) {
    const Channels = require('./channels.js');
    const checked = verifySignedChannelTransferBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const executionCheck = execution ? verifySignedChannelTransferExecution(checked.batch, execution) : null;
    if (executionCheck && !executionCheck.ok) throw new Error(executionCheck.reason);
    const normalizedExecution = executionCheck?.execution || null;

    async function assertRowsMatchChannelState(rows, label) {
        for (const row of rows) {
            const channel = await Channels.getChannel(row.channelAddress);
            const observed = channelBalanceUnits(channel || {}, row.column, row.propertyId);
            if (observed !== row.balanceUnits) {
                throw new Error(`${label} channel row mismatch ${row.key}: expected ${row.balanceUnits}, got ${observed}`);
            }
        }
    }

    if (normalizedExecution) {
        await assertRowsMatchChannelState(normalizedExecution.inputRows, 'pre-state');
    }

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

    if (normalizedExecution) {
        await assertRowsMatchChannelState(normalizedExecution.outputRows, 'post-state');
    }

    return {
        ok: true,
        batchId: checked.batch.batchId,
        transferRoot: checked.batch.batchCore.transferRoot,
        signatureRoot: checked.batch.batchCore.signatureRoot,
        execution: normalizedExecution ? {
            executionId: normalizedExecution.executionCore.executionId,
            inputStateRoot: normalizedExecution.executionCore.inputStateRoot,
            outputStateRoot: normalizedExecution.executionCore.outputStateRoot,
            balanceTransitionRoot: normalizedExecution.executionCore.balanceTransitionRoot,
            authorizationRoot: normalizedExecution.executionCore.authorizationRoot,
            conservationRoot: normalizedExecution.executionCore.conservationRoot
        } : null,
        applied
    };
}

module.exports = {
    SIGNED_CHANNEL_TRANSFER_PROTOCOL,
    SIGNED_CHANNEL_TRANSFER_MESSAGE,
    SIGNED_CHANNEL_TRANSFER_EXECUTION_PROTOCOL,
    normalizeTransferCore,
    transferMessageHash,
    transferIdForCore,
    normalizeSignedTransfer,
    verifySignedTransfer,
    normalizeSignedChannelTransferBatch,
    verifySignedChannelTransferBatch,
    inputRowsFromChannels,
    buildSignedChannelTransferExecution,
    normalizeSignedChannelTransferExecution,
    verifySignedChannelTransferExecution,
    extractSignedChannelTransferBatch,
    extractSignedChannelTransferExecution,
    assertEnvelopeBindsBatch,
    assertEnvelopeBindsExecution,
    applySignedChannelTransferBatch,
    amountValueToUnits,
    tokenUnitsToAmount
};
