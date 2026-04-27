const crypto = require('crypto');
const BigNumber = require('bignumber.js');

function canonicalStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeAddress(value, fieldName, fallback = '') {
    const normalized = value === undefined || value === null ? fallback : String(value).trim();
    if (!normalized) throw new Error(`${fieldName} is required`);
    return normalized;
}

function normalizeOptionalString(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

function normalizePropertyId(value) {
    const propertyId = Number(value);
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
        throw new Error('propertyId must be a positive integer');
    }
    return propertyId;
}

function normalizeAmount(value, fieldName = 'amount') {
    const amount = new BigNumber(value || 0);
    if (!amount.isFinite() || amount.lte(0)) {
        throw new Error(`${fieldName} must be positive`);
    }
    return amount.decimalPlaces(8, BigNumber.ROUND_DOWN);
}

function normalizeOperation(value) {
    const op = Number(value);
    if (![0, 1, 2].includes(op)) {
        throw new Error('encodeDecodeRecode must be 0, 1, or 2');
    }
    return op;
}

function normalizeOutputRef(value, txid = '') {
    const ref = normalizeOptionalString(value);
    if (!ref) return '';
    if (/^\d+$/.test(ref) && txid) return `${txid}:${ref}`;
    return ref;
}

function operationName(op) {
    if (op === 1) return 'encode';
    if (op === 0) return 'decode';
    return 'recode';
}

function buildCommitmentCore(params) {
    const op = normalizeOperation(params.encodeDecodeRecode);
    const propertyId = normalizePropertyId(params.propertyId);
    const amount = normalizeAmount(params.amount);
    const coloredOutputRef = normalizeOptionalString(
        params.coloredOutputRef || params.coloredOutput || params.outputRef || params.commitmentOutput
    );
    const sourceRef = normalizeOutputRef(coloredOutputRef, params.txid) || normalizeOptionalString(params.txid) || 'pending';

    return {
        version: 1,
        protocol: 'tradelayer_tx33_hybrid_colored_coin',
        propertyId,
        amount: amount.toString(),
        satsRatio: Number(params.satsRatio ?? params.SatsRatio ?? 1),
        homeAddress: normalizeOptionalString(params.homeAddress),
        coloredOutputRef: sourceRef,
        tapAssetId: normalizeOptionalString(params.tapAssetId),
        proofRoot: normalizeOptionalString(params.proofRoot),
        rfqId: normalizeOptionalString(params.rfqId),
        bitvmStatusRef: normalizeOptionalString(params.bitvmStatusRef),
        mode: operationName(op)
    };
}

function buildCommitmentId(params) {
    const core = buildCommitmentCore(params);
    return sha256Hex(canonicalStringify({ ...core, mode: 'commitment' }));
}

async function getColoredDb(deps) {
    return deps.db.getDatabase('coloredCoins');
}

async function findRecord(coloredDb, params) {
    const explicitId = normalizeOptionalString(params.commitmentId);
    if (explicitId) {
        return coloredDb.findOneAsync({ _id: `colored::${explicitId}` });
    }

    const outputRef = normalizeOptionalString(
        params.previousOutputRef || params.coloredOutputRef || params.coloredOutput || params.outputRef
    );
    if (outputRef) {
        const index = await coloredDb.findOneAsync({ _id: `colored-output::${outputRef}` });
        if (index && index.commitmentId) {
            return coloredDb.findOneAsync({ _id: `colored::${index.commitmentId}` });
        }
    }

    const computedId = buildCommitmentId(params);
    return coloredDb.findOneAsync({ _id: `colored::${computedId}` });
}

async function saveRecord(coloredDb, record) {
    await coloredDb.updateAsync(
        { _id: record._id },
        { $set: record },
        { upsert: true }
    );
    if (record.currentOutputRef) {
        await coloredDb.updateAsync(
            { _id: `colored-output::${record.currentOutputRef}` },
            { $set: { commitmentId: record.commitmentId, outputRef: record.currentOutputRef } },
            { upsert: true }
        );
    }
}

function getDefaultDeps() {
    return {
        db: require('./db.js'),
        TallyMap: require('./tally.js'),
        PropertyManager: require('./property.js')
    };
}

async function assertPropertyExists(PropertyManager, propertyId) {
    const property = await PropertyManager.getPropertyData(propertyId);
    if (!property) {
        throw new Error(`property ${propertyId} not found`);
    }
    return property;
}

async function processColoredCoin(params, deps = getDefaultDeps()) {
    const op = normalizeOperation(params.encodeDecodeRecode);
    const propertyId = normalizePropertyId(params.propertyId);
    const senderAddress = normalizeAddress(params.senderAddress, 'senderAddress');
    const block = Number(params.block || 0);
    const txid = normalizeOptionalString(params.txid);
    const property = await assertPropertyExists(deps.PropertyManager, propertyId);
    const coloredDb = await getColoredDb(deps);

    if (op === 1) {
        const amount = normalizeAmount(params.amount);
        const commitmentId = buildCommitmentId(params);
        const commitmentCore = buildCommitmentCore(params);
        const existing = await coloredDb.findOneAsync({ _id: `colored::${commitmentId}` });
        if (existing && existing.status !== 'rejected') {
            throw new Error(`colored commitment already exists: ${commitmentId}`);
        }

        const balanceCheck = await deps.TallyMap.hasSufficientBalance(
            senderAddress,
            propertyId,
            amount.toNumber()
        );
        if (!balanceCheck || !balanceCheck.hasSufficient) {
            throw new Error(balanceCheck?.reason || 'insufficient balance for colored encode');
        }

        await deps.TallyMap.updateBalance(
            senderAddress,
            propertyId,
            -amount.toNumber(),
            0,
            0,
            0,
            'coloredCoinEncode',
            block,
            txid
        );

        const record = {
            _id: `colored::${commitmentId}`,
            commitmentId,
            commitmentCore,
            propertyType: property.type,
            status: 'encoded',
            ownerAddress: senderAddress,
            homeAddress: normalizeOptionalString(params.homeAddress || senderAddress),
            currentOutputRef: commitmentCore.coloredOutputRef,
            createdTxid: txid,
            createdBlock: block,
            updatedBlock: block,
            history: [
                {
                    op: 'encode',
                    txid,
                    block,
                    outputRef: commitmentCore.coloredOutputRef
                }
            ]
        };
        await saveRecord(coloredDb, record);
        return record;
    }

    const record = await findRecord(coloredDb, params);
    if (!record) {
        throw new Error('colored commitment not found');
    }

    if (op === 0) {
        if (record.status === 'decoded') {
            throw new Error(`colored commitment already decoded: ${record.commitmentId}`);
        }
        const targetAddress = normalizeAddress(
            params.homeAddress || params.targetAddress || params.senderAddress,
            'decode target address'
        );
        const recordAmount = normalizeAmount(record.commitmentCore.amount);
        await deps.TallyMap.updateBalance(
            targetAddress,
            record.commitmentCore.propertyId,
            recordAmount.toNumber(),
            0,
            0,
            0,
            'coloredCoinDecode',
            block,
            txid
        );
        const next = {
            ...record,
            status: 'decoded',
            decodedBy: senderAddress,
            decodedTo: targetAddress,
            decodedTxid: txid,
            updatedBlock: block,
            decodeProofRoot: normalizeOptionalString(params.proofRoot) || record.commitmentCore.proofRoot,
            history: [
                ...(record.history || []),
                { op: 'decode', txid, block, targetAddress }
            ]
        };
        await saveRecord(coloredDb, next);
        return next;
    }

    const nextOutputRef = normalizeAddress(
        params.newColoredOutputRef || params.coloredOutputRef || params.outputRef,
        'new colored output ref',
        record.currentOutputRef
    );
    const next = {
        ...record,
        status: 'recoded',
        recodedBy: senderAddress,
        currentOutputRef: nextOutputRef,
        updatedBlock: block,
        recodeProofRoot: normalizeOptionalString(params.proofRoot) || record.recodeProofRoot || '',
        history: [
            ...(record.history || []),
            {
                op: 'recode',
                txid,
                block,
                previousOutputRef: record.currentOutputRef,
                outputRef: nextOutputRef
            }
        ]
    };
    await saveRecord(coloredDb, next);
    return next;
}

module.exports = {
    buildCommitmentCore,
    buildCommitmentId,
    processColoredCoin
};
