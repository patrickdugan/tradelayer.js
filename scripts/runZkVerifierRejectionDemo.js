#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const ZkWasmVerifier = require('../src/zkWasmVerifier.js');
const ZkEnvelopeResolver = require('../src/zkEnvelopeResolver.js');

const defaultEnvelopeId = '84e6ec79ad7a683ccdc54555e8709399365b0d8a3da9b9d2a6ddefe81bdb066a';
const defaultOut = path.join('artifacts', 'zk_signed_channel_transfer', 'tx34_verifier_rejection_demo_latest.json');

function parseArgs(argv) {
    const args = {
        envelopeId: process.env.TL_ZK_DEMO_ENVELOPE_ID || defaultEnvelopeId,
        out: process.env.TL_ZK_REJECTION_DEMO_OUT || defaultOut
    };
    for (const arg of argv) {
        if (arg.startsWith('--envelope-id=')) args.envelopeId = arg.slice('--envelope-id='.length);
        else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    }
    return args;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function portablePath(value) {
    const text = String(value || '');
    if (/^[a-z]:\\/i.test(text)) {
        const relative = path.relative(process.cwd(), text);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
    }
    return text;
}

function refreshEnvelopeIds(envelope) {
    const core = envelope.envelopeCore;
    core.publicInputs.daBlobHash = ZkConsensus.buildDaBlobHash(core.daBlob);
    core.publicInputHash = ZkConsensus.hashCanonical(core.publicInputs);
    envelope.envelopeId = ZkConsensus.hashCanonical(core);
    envelope.verifierResult = ZkConsensus.buildZkVerifierResult({
        verifierId: core.verifierId,
        proofType: core.proofType,
        envelopeId: envelope.envelopeId,
        proofHash: core.proofHash,
        programHash: core.programHash,
        publicInputHash: core.publicInputHash,
        daBlobHash: core.publicInputs.daBlobHash,
        verifierWasmHash: core.publicInputs.verifierWasmHash,
        ok: true
    });
    return envelope;
}

function mutateSemanticProofSummaryHash(envelope) {
    const tampered = clone(envelope);
    tampered.envelopeCore.daBlob.value.proofSummary.proofSha256 = ZkConsensus.sha256Hex('tampered proof bytes');
    return refreshEnvelopeIds(tampered);
}

function mutateRawDaBlob(envelope) {
    const tampered = clone(envelope);
    tampered.envelopeCore.daBlob.value.proofSummary.proofSha256 = ZkConsensus.sha256Hex('raw tampered proof bytes');
    return tampered;
}

function mutateVerifierHash(envelope) {
    const tampered = clone(envelope);
    tampered.envelopeCore.publicInputs.verifierWasmHash = ZkConsensus.sha256Hex('unregistered verifier wasm');
    tampered.envelopeCore.publicInputHash = ZkConsensus.hashCanonical(tampered.envelopeCore.publicInputs);
    tampered.envelopeId = ZkConsensus.hashCanonical(tampered.envelopeCore);
    return tampered;
}

async function evaluateCase(name, envelope, note = '') {
    const consensus = ZkConsensus.verifyZkConsensusEnvelope(envelope);
    const wasm = await ZkWasmVerifier.verifyEnvelope(envelope);
    return {
        name,
        note,
        envelopeId: envelope.envelopeId,
        proofHash: envelope.envelopeCore.proofHash,
        proofSummaryProofSha256: envelope.envelopeCore.daBlob?.value?.proofSummary?.proofSha256 || '',
        programHash: envelope.envelopeCore.programHash,
        daBlobHash: envelope.envelopeCore.publicInputs?.daBlobHash || '',
        verifierId: envelope.envelopeCore.verifierId,
        verifierWasmHash: envelope.envelopeCore.publicInputs?.verifierWasmHash || '',
        consensus,
        registeredVerifier: wasm
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const resolved = await ZkEnvelopeResolver.resolveEnvelopeFromParams({
        envelopeId: args.envelopeId,
        envelopeRef: `zkda:${args.envelopeId}`
    });
    if (!resolved.envelope) {
        throw new Error(`could not resolve ZK envelope ${args.envelopeId}: ${resolved.error || 'not found'}`);
    }

    const accepted = await evaluateCase(
        'accepted_current_envelope',
        resolved.envelope,
        'registered verifier approves the current DA blob/proof hash binding'
    );
    const semanticMismatch = await evaluateCase(
        'rejected_self_consistent_proof_summary_mismatch',
        mutateSemanticProofSummaryHash(resolved.envelope),
        'DA blob is rehashed into a self-consistent envelope, but proofSummary.proofSha256 no longer equals envelopeCore.proofHash'
    );
    const rawBlobMismatch = await evaluateCase(
        'rejected_raw_da_blob_mutation',
        mutateRawDaBlob(resolved.envelope),
        'DA blob changed without rebuilding the envelope id/public inputs'
    );
    const verifierMismatch = await evaluateCase(
        'rejected_unregistered_verifier_hash',
        mutateVerifierHash(resolved.envelope),
        'envelope points at a verifier WASM hash outside the consensus registry'
    );

    const result = {
        kind: 'tx34_registered_wasm_verifier_rejection_demo',
        createdAt: new Date().toISOString(),
        source: portablePath(resolved.source),
        sourceEnvelopeId: resolved.envelope.envelopeId,
        sourceVerifierWasmHash: resolved.envelope.envelopeCore.publicInputs.verifierWasmHash,
        cases: [
            accepted,
            semanticMismatch,
            rawBlobMismatch,
            verifierMismatch
        ]
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({
        ok: true,
        artifact: path.resolve(args.out),
        accepted: accepted.consensus.ok && accepted.registeredVerifier.ok,
        rejected: result.cases.slice(1).map((item) => ({
            name: item.name,
            consensusOk: item.consensus.ok,
            verifierOk: item.registeredVerifier.ok,
            reason: item.registeredVerifier.reason || item.consensus.reason || ''
        }))
    }, null, 2));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    refreshEnvelopeIds,
    mutateSemanticProofSummaryHash,
    mutateRawDaBlob,
    mutateVerifierHash,
    evaluateCase
};
