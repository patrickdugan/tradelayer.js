'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ZkConsensus = require('./zkConsensusEnvelope.js');
const ZkProofArtifactResolver = require('./zkProofArtifactResolver.js');

const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;

let wasmPackageLoadAttempted = false;
let wasmPackage = null;
let wasmPackageError = null;
let wasmPackageCodeHash = null;

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadWasmPackage() {
    if (wasmPackageLoadAttempted) return wasmPackage;
    wasmPackageLoadAttempted = true;

    const candidates = [
        path.join(__dirname, '..', 'wasm', 'tlzk_verifier', 'pkg-node', 'tlzk_verifier.js'),
        path.join(__dirname, '..', 'wasm', 'tlzk_verifier', 'pkg-node'),
        path.join(__dirname, '..', 'wasm', 'tlzk_verifier', 'pkg', 'tlzk_verifier.js'),
        path.join(__dirname, '..', 'wasm', 'tlzk_verifier', 'pkg')
    ];

    for (const candidate of candidates) {
        try {
            const candidateDir = candidate.endsWith('.js') ? path.dirname(candidate) : candidate;
            const wasmPath = path.join(candidateDir, 'tlzk_verifier_bg.wasm');
            if (!fs.existsSync(wasmPath)) {
                wasmPackageError = new Error(`missing verifier WASM at ${wasmPath}`);
                continue;
            }
            const codeHash = sha256File(wasmPath);
            ZkConsensus.assertApprovedVerifierWasm(ZkConsensus.DEFAULT_ZK_VERIFIER_ID, codeHash);
            // The generated wasm-bindgen JS package is optional in source checkouts.
            // Production bundles should build it into wasm/tlzk_verifier/pkg.
            // eslint-disable-next-line import/no-dynamic-require, global-require
            wasmPackage = require(candidate);
            if (wasmPackage && typeof wasmPackage.verify_zk_consensus_envelope_json === 'function') {
                wasmPackageCodeHash = codeHash;
                return wasmPackage;
            }
        } catch (err) {
            wasmPackageError = err;
        }
    }

    return null;
}

function parseVerifierJson(raw) {
    if (typeof raw === 'string') return JSON.parse(raw);
    return raw;
}

function requireProofArtifact(options = {}) {
    return Boolean(options.requireProofArtifact) ||
        String(process.env.TL_ZK_REQUIRE_PROOF_ARTIFACT || '').trim() === '1';
}

function attachProofArtifactResult(result, envelope, options = {}) {
    if (!result.ok || !requireProofArtifact(options)) return result;
    const proofArtifact = ZkProofArtifactResolver.verifyProofArtifactBinding(envelope);
    if (!proofArtifact.ok) {
        return {
            ...result,
            ok: false,
            proofArtifact: ZkProofArtifactResolver.portableReceipt(proofArtifact),
            reason: proofArtifact.reason || 'proof artifact binding failed'
        };
    }
    return {
        ...result,
        proofArtifact: ZkProofArtifactResolver.portableReceipt(proofArtifact),
        cryptographicProofVerification: {
            ok: false,
            status: 'not-wired',
            reason: 'STWO cryptographic proof verification over proof bytes is not wired into this verifier yet'
        }
    };
}

async function verifyEnvelope(envelope, options = {}) {
    const envelopeJson = JSON.stringify(envelope);
    if (Buffer.byteLength(envelopeJson, 'utf8') > MAX_ENVELOPE_BYTES) {
        return {
            ok: false,
            mode: 'bounded-verifier',
            reason: 'ZK consensus envelope exceeds deterministic memory limit'
        };
    }

    const verifierId = envelope?.envelopeCore?.verifierId || ZkConsensus.DEFAULT_ZK_VERIFIER_ID;
    const verifierWasmHash = envelope?.envelopeCore?.publicInputs?.verifierWasmHash ||
        ZkConsensus.ZK_VERIFIER_SWITCH[verifierId]?.wasmCodeHash;
    try {
        ZkConsensus.assertApprovedVerifierWasm(verifierId, verifierWasmHash);
    } catch (err) {
        return { ok: false, mode: 'approved-verifier-check', reason: err.message };
    }

    const wasm = loadWasmPackage();
    if (wasm && typeof wasm.verify_zk_consensus_envelope_json === 'function') {
        if (wasmPackageCodeHash !== verifierWasmHash) {
            return {
                ok: false,
                mode: 'rust-wasm',
                wasmCodeHash: wasmPackageCodeHash,
                reason: 'loaded verifier WASM hash does not match envelope verifier identity'
            };
        }
        try {
            const result = {
                ...parseVerifierJson(wasm.verify_zk_consensus_envelope_json(envelopeJson)),
                mode: 'rust-wasm',
                wasmCodeHash: wasmPackageCodeHash
            };
            if (!result.ok) return result;
            const proofSummaryCheck = ZkConsensus.verifyProofSummaryBindings(envelope);
            if (!proofSummaryCheck.ok) {
                return {
                    ...result,
                    ok: false,
                    reason: proofSummaryCheck.reason
                };
            }
            return attachProofArtifactResult(result, envelope, options);
        } catch (err) {
            return { ok: false, mode: 'rust-wasm', wasmCodeHash: wasmPackageCodeHash, reason: err.message };
        }
    }

    if (String(process.env.TL_ZK_ALLOW_JS_VERIFIER_FALLBACK || '').trim() !== '1') {
        return {
            ok: false,
            mode: 'missing-rust-wasm',
            reason: wasmPackageError ? wasmPackageError.message : 'Rust/WASM verifier package is not built or is not consensus-approved'
        };
    }

    return attachProofArtifactResult({
        ...ZkConsensus.verifyZkConsensusEnvelope(envelope),
        mode: 'js-consensus-fallback',
        wasmCodeHash: verifierWasmHash
    }, envelope, options);
}

module.exports = {
    MAX_ENVELOPE_BYTES,
    sha256File,
    loadWasmPackage,
    requireProofArtifact,
    attachProofArtifactResult,
    verifyEnvelope
};
