'use strict';

const BigNumber = require('bignumber.js');
const ZkConsensus = require('./zkConsensusEnvelope.js');

const TX2_SEND_BATCH_PROTOCOL = 'tl_zk_tx2_send_batch_v1';

function normalizeAmountUnits(value, fieldName = 'amountUnits') {
    const text = String(value ?? '').trim();
    if (!/^[0-9]+$/.test(text)) throw new Error(`${fieldName} must be a positive integer string`);
    const amount = BigInt(text);
    if (amount <= 0n) throw new Error(`${fieldName} must be positive`);
    return amount.toString();
}

function normalizeBalanceUnits(value, fieldName = 'availableUnits') {
    const text = String(value ?? '').trim();
    if (!/^[0-9]+$/.test(text)) throw new Error(`${fieldName} must be a non-negative integer string`);
    return BigInt(text).toString();
}

function amountValueToUnits(value, fieldName = 'available') {
    const amount = new BigNumber(String(value ?? 0));
    if (!amount.isFinite() || amount.lt(0)) throw new Error(`${fieldName} must be a non-negative finite amount`);
    return amount.times(1e8).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
}

function tokenUnitsToAmount(amountUnits) {
    return new BigNumber(String(amountUnits)).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN);
}

function rowKey(address, propertyId) {
    return `${address}:${Number(propertyId)}`;
}

function normalizeSend(send = {}, index = 0) {
    const propertyId = Number(send.propertyId);
    const sender = String(send.sender || send.from || send.fromAddress || '');
    const recipient = String(send.recipient || send.to || send.toAddress || '');
    if (!sender || !recipient || sender === recipient) {
        throw new Error(`tx2 send ${index} must have distinct sender/recipient`);
    }
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`tx2 send ${index} has invalid propertyId`);
    }
    return {
        protocol: 'tradelayer_tx2_send_v1',
        sender,
        recipient,
        propertyId,
        amountUnits: normalizeAmountUnits(send.amountUnits ?? send.amountBaseUnits, `tx2 send ${index} amountUnits`),
        nonce: String(send.nonce || send.txid || `tx2-send-${index}`)
    };
}

function normalizeSends(sends = []) {
    if (!Array.isArray(sends) || sends.length === 0) throw new Error('tx2 send batch requires at least one send');
    return sends.map((send, index) => normalizeSend(send, index));
}

function movementsFromSends(sends = []) {
    return normalizeSends(sends).map((send) => ({
        from: send.sender,
        to: send.recipient,
        propertyId: send.propertyId,
        amountUnits: send.amountUnits,
        memo: `tx2-send:${send.nonce}`
    }));
}

function normalizeRow(row = {}, index = 0) {
    const propertyId = Number(row.propertyId);
    const address = String(row.address || '');
    if (!address) throw new Error(`tx2 row ${index} address is required`);
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`tx2 row ${index} has invalid propertyId`);
    }
    return {
        address,
        propertyId,
        availableUnits: normalizeBalanceUnits(row.availableUnits ?? row.balanceUnits ?? '0', `tx2 row ${index} availableUnits`),
        key: rowKey(address, propertyId)
    };
}

function normalizeRows(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('tx2 send batch requires balance rows');
    const seen = new Set();
    return rows.map((row, index) => normalizeRow(row, index))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((row) => {
            if (seen.has(row.key)) throw new Error(`duplicate tx2 balance row ${row.key}`);
            seen.add(row.key);
            return row;
        });
}

function touchedRowsFromSends(sends = [], startingBalances = {}) {
    const keys = new Set();
    for (const send of normalizeSends(sends)) {
        keys.add(rowKey(send.sender, send.propertyId));
        keys.add(rowKey(send.recipient, send.propertyId));
    }
    return [...keys].sort().map((key) => {
        const [address, propertyIdText] = key.split(':');
        const propertyId = Number(propertyIdText);
        const nested = startingBalances[address]?.[propertyId] ?? startingBalances[address]?.[String(propertyId)];
        const direct = startingBalances[key];
        return {
            address,
            propertyId,
            availableUnits: normalizeBalanceUnits(direct ?? nested ?? '0', `${key} starting balance`)
        };
    });
}

function rowsToMap(rows = []) {
    return new Map(normalizeRows(rows).map((row) => [row.key, BigInt(row.availableUnits)]));
}

function outputRowsFromInputRows(inputRows = [], sends = []) {
    const balances = rowsToMap(inputRows);
    for (const send of normalizeSends(sends)) {
        const fromKey = rowKey(send.sender, send.propertyId);
        const toKey = rowKey(send.recipient, send.propertyId);
        if (!balances.has(fromKey) || !balances.has(toKey)) {
            throw new Error(`tx2 send batch missing touched row for ${fromKey} or ${toKey}`);
        }
        const amount = BigInt(send.amountUnits);
        const nextFrom = balances.get(fromKey) - amount;
        if (nextFrom < 0n) throw new Error(`tx2 send batch would overdraw ${fromKey}`);
        balances.set(fromKey, nextFrom);
        balances.set(toKey, balances.get(toKey) + amount);
    }
    return normalizeRows([...balances.entries()].map(([key, value]) => {
        const [address, propertyId] = key.split(':');
        return { address, propertyId: Number(propertyId), availableUnits: value.toString() };
    }));
}

function rowRoot(rows = []) {
    return ZkConsensus.hashCanonical(normalizeRows(rows));
}

function sendBatchCore(batch = {}) {
    const sends = normalizeSends(batch.sends);
    const inputRows = normalizeRows(batch.inputRows || touchedRowsFromSends(sends, batch.startingBalances || {}));
    const outputRows = normalizeRows(batch.outputRows || outputRowsFromInputRows(inputRows, sends));
    const core = {
        protocol: TX2_SEND_BATCH_PROTOCOL,
        sends,
        inputRows,
        outputRows,
        inputStateRoot: rowRoot(inputRows),
        outputStateRoot: rowRoot(outputRows),
        movementRoot: ZkConsensus.buildMovementRoot(movementsFromSends(sends))
    };
    return {
        ...core,
        batchHash: ZkConsensus.hashCanonical(core)
    };
}

function buildTx2SendBatch(batch = {}) {
    return {
        kind: 'tl_zk_tx2_send_batch',
        batchCore: sendBatchCore(batch)
    };
}

function extractTx2SendBatch(envelope) {
    const value = envelope?.envelopeCore?.daBlob?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value.tx2SendBatch || null;
}

function verifyTx2SendBatch(batch = {}) {
    try {
        if (!batch || batch.kind !== 'tl_zk_tx2_send_batch') {
            return { ok: false, reason: 'wrong tx2 send batch kind' };
        }
        const expected = sendBatchCore(batch.batchCore || {});
        if (ZkConsensus.canonicalStringify(batch.batchCore) !== ZkConsensus.canonicalStringify(expected)) {
            return { ok: false, reason: 'tx2 send batch core mismatch' };
        }
        return { ok: true, batch: { kind: 'tl_zk_tx2_send_batch', batchCore: expected } };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

function assertEnvelopeBindsTx2SendBatch(envelope, batch = extractTx2SendBatch(envelope)) {
    const checked = verifyTx2SendBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const normalized = checked.batch;
    const core = normalized.batchCore;
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    const movements = envelope?.envelopeCore?.movements || [];

    if (ZkConsensus.buildMovementRoot(movements) !== core.movementRoot) {
        throw new Error('tx2 send batch movement root mismatch');
    }
    if (publicInputs.tx2SendBatchHash && publicInputs.tx2SendBatchHash !== core.batchHash) {
        throw new Error('tx2 send batch hash public input mismatch');
    }
    if (publicInputs.tx2InputStateRoot && publicInputs.tx2InputStateRoot !== core.inputStateRoot) {
        throw new Error('tx2 input state root public input mismatch');
    }
    if (publicInputs.tx2OutputStateRoot && publicInputs.tx2OutputStateRoot !== core.outputStateRoot) {
        throw new Error('tx2 output state root public input mismatch');
    }
    return {
        normalized,
        batchHash: core.batchHash,
        inputStateRoot: core.inputStateRoot,
        outputStateRoot: core.outputStateRoot
    };
}

async function currentInputRowsFromTally(batch, TallyMap) {
    const checked = verifyTx2SendBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const inputRows = checked.batch.batchCore.inputRows;
    const rows = [];
    for (const row of inputRows) {
        const tally = await TallyMap.getTally(row.address, row.propertyId);
        rows.push({
            address: row.address,
            propertyId: row.propertyId,
            availableUnits: amountValueToUnits(tally?.available || 0, row.key)
        });
    }
    return normalizeRows(rows);
}

async function assertCurrentInputRows(batch, TallyMap) {
    const checked = verifyTx2SendBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const currentRows = await currentInputRowsFromTally(checked.batch, TallyMap);
    const currentRoot = rowRoot(currentRows);
    const expectedRoot = checked.batch.batchCore.inputStateRoot;
    if (currentRoot !== expectedRoot) {
        throw new Error(`tx2 input state root mismatch: ${currentRoot} != ${expectedRoot}`);
    }
    return { currentRows, currentRoot };
}

module.exports = {
    TX2_SEND_BATCH_PROTOCOL,
    normalizeAmountUnits,
    normalizeBalanceUnits,
    amountValueToUnits,
    tokenUnitsToAmount,
    rowKey,
    normalizeSend,
    normalizeSends,
    movementsFromSends,
    normalizeRow,
    normalizeRows,
    touchedRowsFromSends,
    outputRowsFromInputRows,
    rowRoot,
    sendBatchCore,
    buildTx2SendBatch,
    extractTx2SendBatch,
    verifyTx2SendBatch,
    assertEnvelopeBindsTx2SendBatch,
    currentInputRowsFromTally,
    assertCurrentInputRows
};
