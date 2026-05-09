'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const DEFAULT_MAX_PROOF_BYTES = 32 * 1024 * 1024;

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalizeHash(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(text) ? text : '';
}

function proofSummaryFromEnvelope(envelope = {}) {
    const value = envelope?.envelopeCore?.daBlob?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const summary = value.proofSummary;
    return summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : null;
}

function defaultProofRoots() {
    const configured = String(process.env.TL_ZK_PROOF_DIRS || process.env.TL_ZK_PROOF_DIR || '').trim();
    if (configured) {
        return configured.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry));
    }
    return [
        path.join(repoRoot, 'artifacts', 'zk_proofs'),
        path.join(repoRoot, 'artifacts', 'snacksack_proof_runs'),
        path.join('C:', 'projects', 'TLZK', 'artifacts', 'snacksack_proof_runs')
    ];
}

function maxProofBytes() {
    const configured = Number(process.env.TL_ZK_MAX_PROOF_BYTES || DEFAULT_MAX_PROOF_BYTES);
    return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_PROOF_BYTES;
}

function candidateProofPaths(envelope = {}) {
    const summary = proofSummaryFromEnvelope(envelope) || {};
    const publicInputs = envelope?.envelopeCore?.publicInputs || {};
    const proofHash = normalizeHash(envelope?.envelopeCore?.proofHash || summary.proofSha256);
    const proofRun = String(publicInputs.proofRun || summary.proofRun || '').trim();
    const candidates = [];

    for (const raw of [summary.proofPath, summary.localProofPath, publicInputs.proofPath]) {
        const value = String(raw || '').trim();
        if (!value) continue;
        if (path.isAbsolute(value)) candidates.push(value);
        else candidates.push(path.resolve(repoRoot, value));
    }

    for (const root of defaultProofRoots()) {
        if (proofRun) {
            candidates.push(path.join(root, proofRun, 'extracted', 'tlzk_stwo', 'proof.json'));
            candidates.push(path.join(root, proofRun, 'tlzk_stwo', 'proof.json'));
            candidates.push(path.join(root, proofRun, 'proof.json'));
        }
        if (proofHash) {
            candidates.push(path.join(root, `${proofHash}.json`));
            candidates.push(path.join(root, `${proofHash}.proof.json`));
            candidates.push(path.join(root, proofHash, 'proof.json'));
        }
    }

    return [...new Set(candidates)];
}

function findProofArtifact(envelope = {}) {
    const expectedHash = normalizeHash(envelope?.envelopeCore?.proofHash || proofSummaryFromEnvelope(envelope)?.proofSha256);
    const attempts = [];
    for (const candidate of candidateProofPaths(envelope)) {
        attempts.push(candidate);
        if (!fs.existsSync(candidate)) continue;
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (stat.size > maxProofBytes()) {
            return {
                ok: false,
                expectedHash,
                proofPath: candidate,
                attempts,
                reason: `proof artifact exceeds deterministic byte limit: ${stat.size} > ${maxProofBytes()}`
            };
        }
        return {
            ok: true,
            expectedHash,
            proofPath: candidate,
            proofBytes: stat.size,
            attempts
        };
    }
    return {
        ok: false,
        expectedHash,
        attempts,
        reason: 'proof artifact not found'
    };
}

function verifyProofArtifactBinding(envelope = {}) {
    const found = findProofArtifact(envelope);
    if (!found.ok) return found;
    const observedHash = sha256File(found.proofPath);
    const ok = observedHash === found.expectedHash;
    return {
        ...found,
        ok,
        observedHash,
        reason: ok ? '' : 'proof artifact hash mismatch'
    };
}

function portableReceipt(binding = {}) {
    return {
        ok: Boolean(binding.ok),
        expectedHash: binding.expectedHash || '',
        observedHash: binding.observedHash || '',
        proofBytes: binding.proofBytes || 0,
        proofPath: binding.proofPath ? path.basename(binding.proofPath) : '',
        reason: binding.reason || ''
    };
}

module.exports = {
    DEFAULT_MAX_PROOF_BYTES,
    sha256File,
    normalizeHash,
    proofSummaryFromEnvelope,
    defaultProofRoots,
    maxProofBytes,
    candidateProofPaths,
    findProofArtifact,
    verifyProofArtifactBinding,
    portableReceipt
};
