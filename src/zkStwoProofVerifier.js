'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ZkProofArtifactResolver = require('./zkProofArtifactResolver.js');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CHANNEL_HASH = 'blake2s';
const DEFAULT_REMOTE_VERIFY_BIN = 'verify';
const verificationCache = new Map();

function timeoutMs() {
    const configured = Number(process.env.TL_ZK_STWO_VERIFY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function outputTail(value, limit = 4096) {
    const text = String(value || '')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\u00b5/g, 'u')
        .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
    return text.length > limit ? text.slice(text.length - limit) : text;
}

function posixQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sha256Buffer(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parseExtraArgs() {
    const raw = String(process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON must be a JSON array of strings');
    }
    return parsed;
}

function proofSummary(envelope = {}) {
    return ZkProofArtifactResolver.proofSummaryFromEnvelope(envelope) || {};
}

function proofRun(envelope = {}) {
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    return String(publicInputs.proofRun || proofSummary(envelope).proofRun || '').trim();
}

function remoteProofPath(envelope = {}) {
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    const summary = proofSummary(envelope);
    return String(
        publicInputs.remoteProofPath ||
        summary.remoteProofPath ||
        summary.proofPath ||
        ''
    ).trim();
}

function cacheKey(envelope = {}, artifactBinding = {}, options = {}) {
    return JSON.stringify({
        envelopeId: envelope.envelopeId || '',
        proofHash: artifactBinding.observedHash || artifactBinding.expectedHash || envelope?.envelopeCore?.proofHash || '',
        proofBytes: artifactBinding.proofBytes || 0,
        channelHash: channelHash(envelope, options),
        localBin: String(options.verifyBin || process.env.TL_ZK_STWO_VERIFY_BIN || '').trim(),
        localExtraArgs: String(process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON || '').trim(),
        remoteHost: String(options.remoteHost || process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST || '').trim(),
        remoteVerifyBin: String(options.remoteVerifyBin || process.env.TL_ZK_STWO_REMOTE_VERIFY_BIN || DEFAULT_REMOTE_VERIFY_BIN).trim(),
        remoteProofPath: remoteProofPath(envelope)
    });
}

function channelHash(envelope = {}, options = {}) {
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    const summary = proofSummary(envelope);
    return String(
        options.channelHash ||
        process.env.TL_ZK_STWO_CHANNEL_HASH ||
        publicInputs.channelHash ||
        summary.channelHash ||
        DEFAULT_CHANNEL_HASH
    ).trim();
}

function commandReceipt(base, commandResult, startedAt) {
    const elapsedMs = Date.now() - startedAt;
    return {
        ...base,
        ok: commandResult.ok,
        elapsedMs,
        exitCode: commandResult.exitCode,
        stdoutTail: outputTail(commandResult.stdout),
        stderrTail: outputTail(commandResult.stderr),
        reason: commandResult.ok ? '' : commandResult.reason
    };
}

function embeddedWasmCandidates() {
    const configured = String(process.env.TL_ZK_STWO_WASM_PACKAGE || '').trim();
    const repoRoot = path.join(__dirname, '..');
    const candidates = [];
    if (configured) candidates.push(path.resolve(configured));
    candidates.push(path.join(repoRoot, 'wasm', 'tlzk_verifier', 'pkg-node-stwo', 'tlzk_verifier.js'));
    return [...new Set(candidates)];
}

function loadEmbeddedWasmPackage() {
    if (String(process.env.TL_ZK_DISABLE_EMBEDDED_STWO || '').trim() === '1') {
        return { ok: false, attempts: ['disabled by TL_ZK_DISABLE_EMBEDDED_STWO'] };
    }
    const attempts = [];
    for (const candidate of embeddedWasmCandidates()) {
        attempts.push(candidate);
        if (!fs.existsSync(candidate)) continue;
        try {
            // eslint-disable-next-line import/no-dynamic-require, global-require
            const pkg = require(candidate);
            if (!pkg || typeof pkg.verify_stwo_cairo_proof_json !== 'function') {
                continue;
            }
            const wasmPath = path.join(path.dirname(candidate), 'tlzk_verifier_bg.wasm');
            const wasmCodeHash = fs.existsSync(wasmPath)
                ? ZkProofArtifactResolver.sha256File(wasmPath)
                : String(process.env.TL_ZK_STWO_WASM_HASH || '').trim();
            return {
                ok: true,
                packagePath: candidate,
                packageName: path.basename(path.dirname(candidate)),
                wasmCodeHash,
                pkg,
                attempts
            };
        } catch (err) {
            attempts.push(`${candidate}: ${err.message}`);
        }
    }
    return { ok: false, attempts };
}

async function verifyEmbeddedWasmProof(envelope, artifactBinding, options = {}) {
    const loaded = loadEmbeddedWasmPackage();
    if (!loaded.ok) return null;
    const proofBytes = fs.readFileSync(artifactBinding.proofPath);
    const expectedHash = artifactBinding.observedHash || artifactBinding.expectedHash || sha256Buffer(proofBytes);
    const startedAt = Date.now();
    let parsed;
    try {
        parsed = JSON.parse(loaded.pkg.verify_stwo_cairo_proof_json(
            proofBytes.toString('utf8'),
            channelHash(envelope, options),
            expectedHash
        ));
    } catch (err) {
        parsed = {
            ok: false,
            reason: err.message || 'embedded STWO WASM verifier threw'
        };
    }
    const elapsedMs = Date.now() - startedAt;
    const reason = String(parsed.reason || '');
    const unavailable = /embedded-stwo feature is not enabled|not found|is not a function/i.test(reason);
    if (unavailable && String(process.env.TL_ZK_REQUIRE_EMBEDDED_STWO || '').trim() !== '1') {
        return null;
    }
    return {
        mode: 'rust-wasm-embedded-stwo',
        verifierCommand: 'verify_stwo_cairo_proof_json',
        packageName: loaded.packageName,
        wasmCodeHash: loaded.wasmCodeHash,
        proofPath: path.basename(artifactBinding.proofPath),
        proofBytes: artifactBinding.proofBytes || proofBytes.length,
        proofHash: expectedHash,
        channelHash: channelHash(envelope, options),
        ok: Boolean(parsed.ok),
        elapsedMs,
        reason,
        embeddedResult: parsed
    };
}

function execFilePromise(file, args, options = {}) {
    return new Promise((resolve) => {
        execFile(file, args, {
            timeout: timeoutMs(),
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
            ...options
        }, (err, stdout, stderr) => {
            if (err) {
                resolve({
                    ok: false,
                    exitCode: Number.isInteger(err.code) ? err.code : null,
                    stdout,
                    stderr,
                    reason: err.killed ? 'STWO verifier timed out' : err.message
                });
                return;
            }
            resolve({ ok: true, exitCode: 0, stdout, stderr, reason: '' });
        });
    });
}

async function verifyLocalProof(envelope, artifactBinding, options = {}) {
    const verifyBin = String(options.verifyBin || process.env.TL_ZK_STWO_VERIFY_BIN || '').trim();
    if (!verifyBin) return null;
    const startedAt = Date.now();
    const proofPath = artifactBinding.proofPath;
    const args = [
        ...parseExtraArgs(),
        '--proof_path',
        proofPath,
        '--channel_hash',
        channelHash(envelope, options)
    ];
    const commandResult = await execFilePromise(verifyBin, args);
    return commandReceipt({
        mode: 'stwo-local-verify',
        verifierCommand: path.basename(verifyBin),
        proofPath: path.basename(proofPath),
        proofHash: artifactBinding.observedHash || artifactBinding.expectedHash,
        channelHash: channelHash(envelope, options)
    }, commandResult, startedAt);
}

async function verifyRemoteProof(envelope, artifactBinding, options = {}) {
    const host = String(options.remoteHost || process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST || '').trim();
    if (!host) return null;
    const remotePath = remoteProofPath(envelope);
    if (!remotePath) {
        return {
            ok: false,
            mode: 'stwo-remote-verify',
            remoteHost: host,
            reason: 'remote proof path is not present in the proof summary'
        };
    }

    const verifyBin = String(
        options.remoteVerifyBin ||
        process.env.TL_ZK_STWO_REMOTE_VERIFY_BIN ||
        DEFAULT_REMOTE_VERIFY_BIN
    ).trim();
    const expectedHash = artifactBinding.observedHash || artifactBinding.expectedHash || envelope?.envelopeCore?.proofHash;
    const remoteCommand = [
        'set -e',
        `observed=$(sha256sum -- ${posixQuote(remotePath)} | awk '{print $1}')`,
        `test "$observed" = ${posixQuote(expectedHash)}`,
        `${posixQuote(verifyBin)} --proof_path ${posixQuote(remotePath)} --channel_hash ${posixQuote(channelHash(envelope, options))}`
    ].join('; ');
    const startedAt = Date.now();
    const commandResult = await execFilePromise('ssh', [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=15',
        host,
        remoteCommand
    ]);
    return commandReceipt({
        mode: 'stwo-remote-verify',
        remoteHost: host,
        verifierCommand: path.posix.basename(verifyBin),
        proofRun: proofRun(envelope),
        proofPath: path.posix.basename(remotePath),
        proofHash: expectedHash,
        channelHash: channelHash(envelope, options)
    }, commandResult, startedAt);
}

async function verifyCryptographicProof(envelope = {}, options = {}) {
    const artifactBinding = options.artifactBinding || ZkProofArtifactResolver.verifyProofArtifactBinding(envelope);
    if (!artifactBinding.ok) {
        return {
            ok: false,
            mode: 'proof-artifact-binding',
            reason: artifactBinding.reason || 'proof artifact binding failed',
            proofArtifact: ZkProofArtifactResolver.portableReceipt(artifactBinding)
        };
    }

    const key = cacheKey(envelope, artifactBinding, options);
    if (verificationCache.has(key)) {
        return {
            ...verificationCache.get(key),
            cacheHit: true
        };
    }

    const embeddedWasmResult = await verifyEmbeddedWasmProof(envelope, artifactBinding, options);
    if (embeddedWasmResult) {
        if (embeddedWasmResult.ok) verificationCache.set(key, embeddedWasmResult);
        return embeddedWasmResult;
    }

    const localResult = await verifyLocalProof(envelope, artifactBinding, options);
    if (localResult) {
        if (localResult.ok) verificationCache.set(key, localResult);
        return localResult;
    }

    const remoteResult = await verifyRemoteProof(envelope, artifactBinding, options);
    if (remoteResult) {
        if (remoteResult.ok) verificationCache.set(key, remoteResult);
        return remoteResult;
    }

    return {
        ok: false,
        mode: 'stwo-verifier-unavailable',
        proofHash: artifactBinding.observedHash || artifactBinding.expectedHash,
        proofPath: artifactBinding.proofPath ? path.basename(artifactBinding.proofPath) : '',
        reason: 'no STWO verifier configured; set TL_ZK_STWO_VERIFY_BIN or TL_ZK_STWO_REMOTE_VERIFY_HOST'
    };
}

module.exports = {
    DEFAULT_CHANNEL_HASH,
    DEFAULT_REMOTE_VERIFY_BIN,
    timeoutMs,
    channelHash,
    remoteProofPath,
    cacheKey,
    loadEmbeddedWasmPackage,
    verifyEmbeddedWasmProof,
    verifyCryptographicProof
};
