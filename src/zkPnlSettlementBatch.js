'use strict';

const BigNumber = require('bignumber.js');
const ZkConsensus = require('./zkConsensusEnvelope.js');

const PNL_SETTLEMENT_BATCH_PROTOCOL = 'tl_zk_pnl_settlement_batch_v1';

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

function amountValueToUnits(value, fieldName = 'amount') {
    const amount = new BigNumber(String(value ?? 0));
    if (!amount.isFinite() || amount.lt(0)) throw new Error(`${fieldName} must be a non-negative finite amount`);
    return amount.times(1e8).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
}

function tokenUnitsToAmount(amountUnits) {
    return new BigNumber(String(amountUnits)).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN);
}

function balanceKey(channelAddress, column, propertyId) {
    return `${channelAddress}:${normalizeColumn(column, 'column')}:${Number(propertyId)}`;
}

function parseBalanceKey(key) {
    const parts = String(key).split(':');
    if (parts.length < 3) throw new Error(`invalid PNL balance key ${key}`);
    const propertyId = Number(parts.pop());
    const column = normalizeColumn(parts.pop(), `PNL balance key ${key} column`);
    const channelAddress = parts.join(':');
    if (!channelAddress || !Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`invalid PNL balance key ${key}`);
    }
    return { channelAddress, column, propertyId };
}

function payerColumnForSettlement(settlement = {}) {
    if (settlement.payerColumn) return normalizeColumn(settlement.payerColumn, 'payerColumn');
    const txType = Number(settlement.txType ?? (settlement.settleType === 3 ? 31 : 23));
    const settleType = Number(settlement.settleType ?? (txType === 31 ? 3 : 2));

    if (txType === 31 || settleType === 3) {
        return settlement.aPaysBDirection ? 'A' : 'B';
    }

    if (settleType !== 2) throw new Error(`unsupported PNL settlement settleType ${settleType}`);
    const netAmount = new BigNumber(String(settlement.netAmount ?? 0));
    if (!netAmount.isFinite()) throw new Error('tx23 NET_SETTLE netAmount must be finite');
    const columnAIsSeller = Boolean(settlement.columnAIsSeller);
    return (columnAIsSeller && netAmount.gte(0)) || (!columnAIsSeller && netAmount.lt(0)) ? 'A' : 'B';
}

function receiverColumnForPayer(payerColumn) {
    return normalizeColumn(payerColumn, 'payerColumn') === 'A' ? 'B' : 'A';
}

function amountUnitsForSettlement(settlement = {}, index = 0) {
    if (settlement.amountUnits !== undefined || settlement.amountBaseUnits !== undefined) {
        return normalizeAmountUnits(settlement.amountUnits ?? settlement.amountBaseUnits, `PNL settlement ${index} amountUnits`);
    }
    const netAmount = new BigNumber(String(settlement.netAmount ?? 0)).abs();
    if (!netAmount.isFinite() || netAmount.lte(0)) {
        throw new Error(`PNL settlement ${index} requires positive amountUnits or non-zero netAmount`);
    }
    return amountValueToUnits(netAmount, `PNL settlement ${index} netAmount`);
}

function normalizeSettlement(settlement = {}, index = 0) {
    const txType = Number(settlement.txType ?? (settlement.settleType === 3 ? 31 : 23));
    const settleType = Number(settlement.settleType ?? (txType === 31 ? 3 : 2));
    const channelAddress = String(settlement.channelAddress || settlement.senderAddress || '');
    const propertyId = Number(settlement.propertyId);
    if (!channelAddress) throw new Error(`PNL settlement ${index} channelAddress is required`);
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`PNL settlement ${index} has invalid propertyId`);
    }
    if (!((txType === 23 && settleType === 2) || txType === 31 || settleType === 3)) {
        throw new Error(`PNL settlement ${index} must be tx23 settleType=2 or tx31`);
    }

    const payerColumn = payerColumnForSettlement({ ...settlement, txType, settleType });
    const receiverColumn = receiverColumnForPayer(payerColumn);
    const amountUnits = amountUnitsForSettlement(settlement, index);

    return {
        protocol: txType === 31 || settleType === 3 ? 'tradelayer_tx31_king_settle_v1' : 'tradelayer_tx23_net_settle_v1',
        txType: txType === 31 || settleType === 3 ? 31 : 23,
        settleType: txType === 31 || settleType === 3 ? 3 : 2,
        channelAddress,
        propertyId,
        amountUnits,
        payerColumn,
        receiverColumn,
        txidNeutralized1: String(settlement.txidNeutralized1 || ''),
        txidNeutralized2: String(settlement.txidNeutralized2 || ''),
        blockStart: settlement.blockStart === undefined ? undefined : Number(settlement.blockStart),
        blockEnd: settlement.blockEnd === undefined ? undefined : Number(settlement.blockEnd),
        channelRoot: String(settlement.channelRoot || ''),
        totalContracts: settlement.totalContracts === undefined ? undefined : Number(settlement.totalContracts),
        neutralizedCount: settlement.neutralizedCount === undefined ? undefined : Number(settlement.neutralizedCount),
        nonce: String(settlement.nonce || settlement.txid || `pnl-settlement-${index}`)
    };
}

function normalizeSettlements(settlements = []) {
    if (!Array.isArray(settlements) || settlements.length === 0) {
        throw new Error('PNL settlement batch requires at least one settlement');
    }
    return settlements.map((settlement, index) => normalizeSettlement(settlement, index));
}

function movementsFromSettlements(settlements = []) {
    return normalizeSettlements(settlements).map((settlement) => ({
        from: `channel:${settlement.channelAddress}:${settlement.payerColumn}`,
        to: `channel:${settlement.channelAddress}:${settlement.receiverColumn}`,
        propertyId: settlement.propertyId,
        amountUnits: settlement.amountUnits,
        memo: `pnl-settlement:${settlement.txType}:${settlement.nonce}`
    }));
}

function normalizeRow(row = {}, index = 0) {
    const propertyId = Number(row.propertyId);
    const channelAddress = String(row.channelAddress || row.channel || '');
    if (!channelAddress) throw new Error(`PNL row ${index} channelAddress is required`);
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`PNL row ${index} has invalid propertyId`);
    }
    const column = normalizeColumn(row.column, `PNL row ${index} column`);
    return {
        channelAddress,
        column,
        propertyId,
        balanceUnits: normalizeBalanceUnits(row.balanceUnits ?? row.availableUnits ?? '0', `PNL row ${index} balanceUnits`),
        key: balanceKey(channelAddress, column, propertyId)
    };
}

function normalizeRows(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('PNL settlement batch requires balance rows');
    const seen = new Set();
    return rows.map((row, index) => normalizeRow(row, index))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((row) => {
            if (seen.has(row.key)) throw new Error(`duplicate PNL balance row ${row.key}`);
            seen.add(row.key);
            return row;
        });
}

function touchedRowsFromSettlements(settlements = [], startingChannels = {}) {
    const keys = new Set();
    for (const settlement of normalizeSettlements(settlements)) {
        keys.add(balanceKey(settlement.channelAddress, settlement.payerColumn, settlement.propertyId));
        keys.add(balanceKey(settlement.channelAddress, settlement.receiverColumn, settlement.propertyId));
    }
    return [...keys].sort().map((key) => {
        const parsed = parseBalanceKey(key);
        const channel = startingChannels[parsed.channelAddress] || {};
        const balance = channel?.[parsed.column]?.[parsed.propertyId] ?? channel?.[parsed.column]?.[String(parsed.propertyId)] ?? 0;
        return {
            ...parsed,
            balanceUnits: normalizeBalanceUnits(amountValueToUnits(balance, key), `${key} balanceUnits`),
            key
        };
    });
}

function rowsToMap(rows = []) {
    return new Map(normalizeRows(rows).map((row) => [row.key, BigInt(row.balanceUnits)]));
}

function outputRowsFromInputRows(inputRows = [], settlements = []) {
    const balances = rowsToMap(inputRows);
    for (const settlement of normalizeSettlements(settlements)) {
        const payerKey = balanceKey(settlement.channelAddress, settlement.payerColumn, settlement.propertyId);
        const receiverKey = balanceKey(settlement.channelAddress, settlement.receiverColumn, settlement.propertyId);
        if (!balances.has(payerKey) || !balances.has(receiverKey)) {
            throw new Error(`PNL settlement batch missing touched row for ${payerKey} or ${receiverKey}`);
        }
        const amount = BigInt(settlement.amountUnits);
        const nextPayer = balances.get(payerKey) - amount;
        if (nextPayer < 0n) throw new Error(`PNL settlement batch would overdraw ${payerKey}`);
        balances.set(payerKey, nextPayer);
        balances.set(receiverKey, balances.get(receiverKey) + amount);
    }
    return normalizeRows([...balances.entries()].map(([key, value]) => ({
        ...parseBalanceKey(key),
        balanceUnits: value.toString()
    })));
}

function rowRoot(rows = []) {
    return ZkConsensus.hashCanonical(normalizeRows(rows));
}

function settlementBatchCore(batch = {}) {
    const settlements = normalizeSettlements(batch.settlements);
    const inputRows = normalizeRows(batch.inputRows || touchedRowsFromSettlements(settlements, batch.startingChannels || {}));
    const outputRows = normalizeRows(batch.outputRows || outputRowsFromInputRows(inputRows, settlements));
    const core = {
        protocol: PNL_SETTLEMENT_BATCH_PROTOCOL,
        settlements,
        inputRows,
        outputRows,
        inputStateRoot: rowRoot(inputRows),
        outputStateRoot: rowRoot(outputRows),
        settlementRoot: ZkConsensus.hashCanonical(settlements),
        movementRoot: ZkConsensus.buildMovementRoot(movementsFromSettlements(settlements))
    };
    return {
        ...core,
        batchHash: ZkConsensus.hashCanonical(core)
    };
}

function buildPnlSettlementBatch(batch = {}) {
    return {
        kind: 'tl_zk_pnl_settlement_batch',
        batchCore: settlementBatchCore(batch)
    };
}

function extractPnlSettlementBatch(envelope) {
    const value = envelope?.envelopeCore?.daBlob?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value.pnlSettlementBatch || null;
}

function verifyPnlSettlementBatch(batch = {}) {
    try {
        if (!batch || batch.kind !== 'tl_zk_pnl_settlement_batch') {
            return { ok: false, reason: 'wrong PNL settlement batch kind' };
        }
        const expected = settlementBatchCore(batch.batchCore || {});
        if (ZkConsensus.canonicalStringify(batch.batchCore) !== ZkConsensus.canonicalStringify(expected)) {
            return { ok: false, reason: 'PNL settlement batch core mismatch' };
        }
        return { ok: true, batch: { kind: 'tl_zk_pnl_settlement_batch', batchCore: expected } };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

function assertEnvelopeBindsPnlSettlementBatch(envelope, batch = extractPnlSettlementBatch(envelope)) {
    const checked = verifyPnlSettlementBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const normalized = checked.batch;
    const core = normalized.batchCore;
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    const movements = envelope?.envelopeCore?.movements || [];

    if (ZkConsensus.buildMovementRoot(movements) !== core.movementRoot) {
        throw new Error('PNL settlement batch movement root mismatch');
    }
    const expectedFields = {
        pnlSettlementBatchHash: core.batchHash,
        pnlSettlementRoot: core.settlementRoot,
        pnlInputStateRoot: core.inputStateRoot,
        pnlOutputStateRoot: core.outputStateRoot
    };
    for (const [field, expected] of Object.entries(expectedFields)) {
        if (publicInputs[field] && publicInputs[field] !== expected) {
            throw new Error(`${field} mismatch`);
        }
    }
    return {
        normalized,
        batchHash: core.batchHash,
        settlementRoot: core.settlementRoot,
        inputStateRoot: core.inputStateRoot,
        outputStateRoot: core.outputStateRoot
    };
}

async function currentInputRowsFromChannels(batch, Channels) {
    const checked = verifyPnlSettlementBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const rows = [];
    for (const row of checked.batch.batchCore.inputRows) {
        const channel = await Channels.getChannel(row.channelAddress);
        const balance = channel?.[row.column]?.[row.propertyId] ?? channel?.[row.column]?.[String(row.propertyId)] ?? 0;
        rows.push({
            channelAddress: row.channelAddress,
            column: row.column,
            propertyId: row.propertyId,
            balanceUnits: amountValueToUnits(balance, row.key)
        });
    }
    return normalizeRows(rows);
}

async function assertCurrentInputRows(batch, Channels) {
    const checked = verifyPnlSettlementBatch(batch);
    if (!checked.ok) throw new Error(checked.reason);
    const currentRows = await currentInputRowsFromChannels(checked.batch, Channels);
    const currentRoot = rowRoot(currentRows);
    const expectedRoot = checked.batch.batchCore.inputStateRoot;
    if (currentRoot !== expectedRoot) {
        throw new Error(`PNL input state root mismatch: ${currentRoot} != ${expectedRoot}`);
    }
    return { currentRows, currentRoot };
}

module.exports = {
    PNL_SETTLEMENT_BATCH_PROTOCOL,
    normalizeAmountUnits,
    normalizeBalanceUnits,
    amountValueToUnits,
    tokenUnitsToAmount,
    balanceKey,
    parseBalanceKey,
    normalizeSettlement,
    normalizeSettlements,
    movementsFromSettlements,
    normalizeRow,
    normalizeRows,
    touchedRowsFromSettlements,
    outputRowsFromInputRows,
    rowRoot,
    settlementBatchCore,
    buildPnlSettlementBatch,
    extractPnlSettlementBatch,
    verifyPnlSettlementBatch,
    assertEnvelopeBindsPnlSettlementBatch,
    currentInputRowsFromChannels,
    assertCurrentInputRows
};
