#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ZkEnvelopeResolver = require('../src/zkEnvelopeResolver.js');
const ZkWasmVerifier = require('../src/zkWasmVerifier.js');
const ZkProofArtifactResolver = require('../src/zkProofArtifactResolver.js');
const {
    loadRuntime,
    bootstrapRuntime,
    evaluateTxConsensus
} = require('./runZkVerifierRejectionDemo.js');

const defaultEnvelopeId = '84e6ec79ad7a683ccdc54555e8709399365b0d8a3da9b9d2a6ddefe81bdb066a';
const defaultOut = path.join('artifacts', 'zk_signed_channel_transfer', 'tx34_full_proof_artifact_demo_latest.json');

function parseArgs(argv) {
    const args = {
        envelopeId: process.env.TL_ZK_DEMO_ENVELOPE_ID || defaultEnvelopeId,
        out: process.env.TL_ZK_FULL_PROOF_ARTIFACT_OUT || defaultOut
    };
    for (const arg of argv) {
        if (arg.startsWith('--envelope-id=')) args.envelopeId = arg.slice('--envelope-id='.length);
        else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    process.env.TL_ZK_REQUIRE_PROOF_ARTIFACT = '1';

    const resolved = await ZkEnvelopeResolver.resolveEnvelopeFromParams({
        envelopeId: args.envelopeId,
        envelopeRef: `zkda:${args.envelopeId}`
    });
    if (!resolved.envelope) {
        throw new Error(`could not resolve ZK envelope ${args.envelopeId}: ${resolved.error || 'not found'}`);
    }

    const artifactBinding = ZkProofArtifactResolver.verifyProofArtifactBinding(resolved.envelope);
    const verifier = await ZkWasmVerifier.verifyEnvelope(resolved.envelope, { requireProofArtifact: true });
    const runtime = loadRuntime();
    await bootstrapRuntime(runtime);
    const txConsensus = await evaluateTxConsensus(runtime, resolved.envelope, true);

    const result = {
        kind: 'tx34_full_proof_artifact_demo',
        createdAt: new Date().toISOString(),
        envelopeId: resolved.envelope.envelopeId,
        proofHash: resolved.envelope.envelopeCore.proofHash,
        verifierId: resolved.envelope.envelopeCore.verifierId,
        verifierWasmHash: resolved.envelope.envelopeCore.publicInputs.verifierWasmHash,
        proofArtifactBinding: ZkProofArtifactResolver.portableReceipt(artifactBinding),
        registeredVerifier: verifier,
        txConsensus,
        caveat: 'This materializes and hashes the whole STWO proof artifact inside the tx34 validation path. Cryptographic STWO verification over the proof bytes is not wired yet.'
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);

    console.log(JSON.stringify({
        ok: Boolean(
            artifactBinding.ok &&
            verifier.ok &&
            txConsensus.validity.valid &&
            txConsensus.logicApplied &&
            txConsensus.outputRowsMatch?.ok
        ),
        artifact: path.resolve(args.out),
        envelopeId: result.envelopeId,
        proofBytes: result.proofArtifactBinding.proofBytes,
        proofHash: result.proofArtifactBinding.observedHash,
        verifierMode: verifier.mode,
        logicApplied: txConsensus.logicApplied,
        cryptographicProofVerification: verifier.cryptographicProofVerification || null
    }, null, 2));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    });
}

module.exports = {
    parseArgs
};
