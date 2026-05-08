'use strict';

const path = require('path');
const ZkConsensus = require('./zkConsensusEnvelope.js');

const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;

let wasmPackageLoadAttempted = false;
let wasmPackage = null;
let wasmPackageError = null;

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
            // The generated wasm-bindgen JS package is optional in source checkouts.
            // Production bundles should build it into wasm/tlzk_verifier/pkg.
            // eslint-disable-next-line import/no-dynamic-require, global-require
            wasmPackage = require(candidate);
            if (wasmPackage && typeof wasmPackage.verify_zk_consensus_envelope_json === 'function') {
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

async function verifyEnvelope(envelope) {
    const envelopeJson = JSON.stringify(envelope);
    if (Buffer.byteLength(envelopeJson, 'utf8') > MAX_ENVELOPE_BYTES) {
        return {
            ok: false,
            mode: 'bounded-verifier',
            reason: 'ZK consensus envelope exceeds deterministic memory limit'
        };
    }

    const wasm = loadWasmPackage();
    if (wasm && typeof wasm.verify_zk_consensus_envelope_json === 'function') {
        try {
            return {
                ...parseVerifierJson(wasm.verify_zk_consensus_envelope_json(envelopeJson)),
                mode: 'rust-wasm'
            };
        } catch (err) {
            return { ok: false, mode: 'rust-wasm', reason: err.message };
        }
    }

    if (String(process.env.TL_ZK_REQUIRE_WASM || '').trim() === '1') {
        return {
            ok: false,
            mode: 'missing-rust-wasm',
            reason: wasmPackageError ? wasmPackageError.message : 'Rust/WASM verifier package is not built'
        };
    }

    return {
        ...ZkConsensus.verifyZkConsensusEnvelope(envelope),
        mode: 'js-consensus-fallback'
    };
}

module.exports = {
    MAX_ENVELOPE_BYTES,
    loadWasmPackage,
    verifyEnvelope
};
