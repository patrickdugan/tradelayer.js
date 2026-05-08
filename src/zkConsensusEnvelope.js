'use strict';

const crypto = require('crypto');

const ZK_CONSENSUS_ENVELOPE_PROTOCOL = 'tlzk_zk_consensus_envelope_v1';
const ZK_VERIFIER_RESULT_PROTOCOL = 'tlzk_zk_verifier_result_v1';
const DEFAULT_ZK_VERIFIER_ID = 'tlzk_rust_wasm_v0';
const DEFAULT_ZK_PROOF_TYPE = 'stwo-cairo-batch-binding-v1';

const ZK_VERIFIER_SWITCH = {
    tlzk_rust_wasm_v0: {
        package: 'wasm/tlzk_verifier',
        wasmExport: 'verify_zk_consensus_envelope_json',
        proofTypes: [
            'stwo-cairo-batch-binding-v1',
            'stwo-cairo-transition-v1',
            'raito-spv-inclusion-v1'
        ]
    }
};

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalStringify(value) {
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;

    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function hashCanonical(value) {
    return sha256Hex(canonicalStringify(value));
}

function normalizeHexString(value, fieldName) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text.length % 2 !== 0 || !/^[0-9a-f]+$/.test(text)) {
        throw new Error(`${fieldName} must be non-empty even-length hex`);
    }
    return text;
}

function normalizeHash(value, fieldName) {
    const text = String(value || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(text)) {
        throw new Error(`${fieldName} must be a 32-byte hex hash`);
    }
    return text;
}

function hashHexString(value, fieldName) {
    return sha256Hex(normalizeHexString(value, fieldName));
}

function normalizeTokenMovement(movement = {}, index = 0) {
    const propertyId = Number(movement.propertyId);
    const amountUnitsText = String(movement.amountUnits ?? movement.amountBaseUnits ?? '0');
    if (!/^[0-9]+$/.test(amountUnitsText)) {
        throw new Error(`movement ${index} amountUnits must be a positive integer string`);
    }
    const amountUnits = BigInt(amountUnitsText);
    const from = String(movement.from || movement.fromAddress || '');
    const to = String(movement.to || movement.toAddress || '');
    if (!Number.isSafeInteger(propertyId) || propertyId <= 0) {
        throw new Error(`movement ${index} has invalid propertyId`);
    }
    if (amountUnits <= 0n) {
        throw new Error(`movement ${index} has invalid amountUnits`);
    }
    if (!from || !to || from === to) {
        throw new Error(`movement ${index} must have distinct from/to addresses`);
    }
    return {
        from,
        to,
        propertyId,
        amountUnits: amountUnits.toString(),
        memo: String(movement.memo || '')
    };
}

function normalizeMovements(movements = []) {
    if (!Array.isArray(movements) || movements.length === 0) {
        throw new Error('ZK batch movement requires at least one token movement');
    }
    return movements.map((movement, index) => normalizeTokenMovement(movement, index));
}

function buildMovementRoot(movements = []) {
    return hashCanonical(normalizeMovements(movements));
}

function normalizeDaBlob(daBlob = {}) {
    if (typeof daBlob === 'string') {
        return {
            kind: 'raw',
            bytes: Buffer.byteLength(daBlob, 'utf8'),
            value: daBlob
        };
    }

    const { kind, carrier, encoding, value, ...rest } = daBlob || {};
    return {
        kind: String(kind || 'zk-witness-da-blob'),
        carrier: String(carrier || 'segwit-witness'),
        encoding: String(encoding || 'json'),
        value: value === undefined ? rest : value
    };
}

function buildDaBlobHash(daBlob = {}) {
    return hashCanonical(normalizeDaBlob(daBlob));
}

function assertSupportedVerifier(verifierId, proofType) {
    const verifier = ZK_VERIFIER_SWITCH[verifierId];
    if (!verifier) throw new Error(`unsupported ZK verifier ${verifierId}`);
    if (!verifier.proofTypes.includes(proofType)) {
        throw new Error(`verifier ${verifierId} does not support proof type ${proofType}`);
    }
    return verifier;
}

function buildZkVerifierResult({
    verifierId,
    proofType,
    envelopeId,
    proofHash,
    programHash,
    publicInputHash,
    daBlobHash,
    ok = true,
    status = 'accepted-by-wasm-verifier'
} = {}) {
    const resultCore = {
        protocol: ZK_VERIFIER_RESULT_PROTOCOL,
        verifierId: String(verifierId || ''),
        proofType: String(proofType || ''),
        envelopeId: String(envelopeId || ''),
        proofHash: String(proofHash || '').toLowerCase(),
        programHash: String(programHash || '').toLowerCase(),
        publicInputHash: String(publicInputHash || '').toLowerCase(),
        daBlobHash: String(daBlobHash || '').toLowerCase(),
        ok: Boolean(ok),
        status: String(status || '')
    };
    return {
        kind: 'tlzk_zk_verifier_result',
        resultId: hashCanonical(resultCore),
        resultCore
    };
}

function buildZkConsensusEnvelope({
    verifierId = DEFAULT_ZK_VERIFIER_ID,
    proofType = DEFAULT_ZK_PROOF_TYPE,
    proofHash,
    programHash,
    publicInputs = {},
    daBlob = {},
    signedL1TxHex,
    batchL2TxHex,
    movements,
    verifierResult = null
} = {}) {
    assertSupportedVerifier(verifierId, proofType);
    const normalizedMovements = normalizeMovements(movements);
    const movementRoot = buildMovementRoot(normalizedMovements);
    const signedL1TxHash = hashHexString(signedL1TxHex, 'signedL1TxHex');
    const batchL2TxHash = hashHexString(batchL2TxHex, 'batchL2TxHex');
    const normalizedDaBlob = normalizeDaBlob(daBlob);
    const daBlobHash = hashCanonical(normalizedDaBlob);
    const normalizedPublicInputs = {
        ...publicInputs,
        movementRoot,
        signedL1TxHash,
        batchL2TxHash,
        daBlobHash
    };
    const publicInputHash = hashCanonical(normalizedPublicInputs);
    const envelopeCore = {
        protocol: ZK_CONSENSUS_ENVELOPE_PROTOCOL,
        verifierId,
        proofType,
        proofHash: normalizeHash(proofHash, 'proofHash'),
        programHash: normalizeHash(programHash, 'programHash'),
        publicInputs: normalizedPublicInputs,
        publicInputHash,
        daBlob: normalizedDaBlob,
        signedL1Tx: {
            kind: 'signed-bitcoin-tx-hex',
            encoding: 'hex',
            hash: signedL1TxHash,
            hex: normalizeHexString(signedL1TxHex, 'signedL1TxHex')
        },
        batchL2Tx: {
            kind: 'signed-tradelayer-l2-batch-tx-hex',
            encoding: 'hex',
            hash: batchL2TxHash,
            hex: normalizeHexString(batchL2TxHex, 'batchL2TxHex')
        },
        movementRoot,
        movements: normalizedMovements
    };
    const envelopeId = hashCanonical(envelopeCore);
    const result = verifierResult || buildZkVerifierResult({
        verifierId,
        proofType,
        envelopeId,
        proofHash: envelopeCore.proofHash,
        programHash: envelopeCore.programHash,
        publicInputHash,
        daBlobHash,
        ok: true
    });
    return {
        kind: 'tlzk_zk_consensus_envelope',
        envelopeId,
        envelopeCore,
        verifierResult: result
    };
}

function verifyZkVerifierResult(result, envelope) {
    if (!result || result.kind !== 'tlzk_zk_verifier_result') {
        return { ok: false, reason: 'missing ZK verifier result' };
    }
    if (result.resultId !== hashCanonical(result.resultCore)) {
        return { ok: false, reason: 'ZK verifier result id mismatch' };
    }
    const core = result.resultCore || {};
    const envelopeCore = envelope.envelopeCore || {};
    if (core.ok !== true) return { ok: false, reason: 'ZK verifier result is not ok' };
    if (core.envelopeId !== envelope.envelopeId) return { ok: false, reason: 'ZK verifier result envelope mismatch' };
    if (core.verifierId !== envelopeCore.verifierId) return { ok: false, reason: 'ZK verifier result verifier mismatch' };
    if (core.proofType !== envelopeCore.proofType) return { ok: false, reason: 'ZK verifier result proof type mismatch' };
    if (core.proofHash !== envelopeCore.proofHash) return { ok: false, reason: 'ZK verifier result proof hash mismatch' };
    if (core.programHash !== envelopeCore.programHash) return { ok: false, reason: 'ZK verifier result program hash mismatch' };
    if (core.publicInputHash !== envelopeCore.publicInputHash) {
        return { ok: false, reason: 'ZK verifier result public input mismatch' };
    }
    if (core.daBlobHash !== envelopeCore.publicInputs.daBlobHash) {
        return { ok: false, reason: 'ZK verifier result DA blob mismatch' };
    }
    return { ok: true };
}

function verifyZkConsensusEnvelope(envelope) {
    try {
        if (!envelope || envelope.kind !== 'tlzk_zk_consensus_envelope') {
            return { ok: false, reason: 'wrong ZK consensus envelope kind' };
        }
        const core = envelope.envelopeCore || {};
        if (core.protocol !== ZK_CONSENSUS_ENVELOPE_PROTOCOL) {
            return { ok: false, reason: 'wrong ZK consensus envelope protocol' };
        }
        assertSupportedVerifier(core.verifierId, core.proofType);
        normalizeHash(core.proofHash, 'proofHash');
        normalizeHash(core.programHash, 'programHash');
        if (envelope.envelopeId !== hashCanonical(core)) {
            return { ok: false, reason: 'ZK consensus envelope id mismatch' };
        }
        const normalizedMovements = normalizeMovements(core.movements);
        const movementRoot = buildMovementRoot(normalizedMovements);
        if (movementRoot !== core.movementRoot || movementRoot !== core.publicInputs?.movementRoot) {
            return { ok: false, reason: 'ZK movement root mismatch' };
        }
        if (core.signedL1Tx?.kind !== 'signed-bitcoin-tx-hex') {
            return { ok: false, reason: 'unsupported signed L1 transaction kind' };
        }
        if (hashHexString(core.signedL1Tx?.hex, 'signedL1Tx.hex') !== core.signedL1Tx?.hash) {
            return { ok: false, reason: 'signed L1 transaction hash mismatch' };
        }
        if (core.signedL1Tx.hash !== core.publicInputs.signedL1TxHash) {
            return { ok: false, reason: 'signed L1 transaction public input mismatch' };
        }
        if (core.batchL2Tx?.kind !== 'signed-tradelayer-l2-batch-tx-hex') {
            return { ok: false, reason: 'unsupported batch L2 transaction kind' };
        }
        if (hashHexString(core.batchL2Tx?.hex, 'batchL2Tx.hex') !== core.batchL2Tx?.hash) {
            return { ok: false, reason: 'batch L2 transaction hash mismatch' };
        }
        if (core.batchL2Tx.hash !== core.publicInputs.batchL2TxHash) {
            return { ok: false, reason: 'batch L2 transaction public input mismatch' };
        }
        const daBlobHash = hashCanonical(normalizeDaBlob(core.daBlob));
        if (daBlobHash !== core.publicInputs.daBlobHash) {
            return { ok: false, reason: 'DA blob public input mismatch' };
        }
        if (hashCanonical(core.publicInputs) !== core.publicInputHash) {
            return { ok: false, reason: 'public input hash mismatch' };
        }
        const resultCheck = verifyZkVerifierResult(envelope.verifierResult, envelope);
        if (!resultCheck.ok) return resultCheck;
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

function compactFieldsFromEnvelope(envelope) {
    const core = envelope.envelopeCore || {};
    return {
        envelopeId: envelope.envelopeId,
        movementRoot: core.movementRoot,
        proofHash: core.proofHash,
        verifierId: core.verifierId,
        proofType: core.proofType,
        programHash: core.programHash,
        publicInputHash: core.publicInputHash,
        daBlobHash: core.publicInputs?.daBlobHash,
        signedL1TxHash: core.signedL1Tx?.hash,
        batchL2TxHash: core.batchL2Tx?.hash,
        resultId: envelope.verifierResult?.resultId
    };
}

module.exports = {
    ZK_CONSENSUS_ENVELOPE_PROTOCOL,
    ZK_VERIFIER_RESULT_PROTOCOL,
    DEFAULT_ZK_VERIFIER_ID,
    DEFAULT_ZK_PROOF_TYPE,
    ZK_VERIFIER_SWITCH,
    sha256Hex,
    canonicalStringify,
    hashCanonical,
    normalizeHexString,
    normalizeHash,
    hashHexString,
    normalizeTokenMovement,
    normalizeMovements,
    buildMovementRoot,
    normalizeDaBlob,
    buildDaBlobHash,
    buildZkVerifierResult,
    buildZkConsensusEnvelope,
    verifyZkVerifierResult,
    verifyZkConsensusEnvelope,
    compactFieldsFromEnvelope
};
