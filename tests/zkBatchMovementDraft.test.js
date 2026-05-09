'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const secp = require('tiny-secp256k1');
const Encode = require('../src/txEncoder.js');
const Decode = require('../src/txDecoder.js');
const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const ZkWasmVerifier = require('../src/zkWasmVerifier.js');
const ZkEnvelopeResolver = require('../src/zkEnvelopeResolver.js');
const ZkProofArtifactResolver = require('../src/zkProofArtifactResolver.js');
const SignedChannelTransfer = require('../src/zkSignedChannelTransfer.js');
const RejectionDemo = require('../scripts/runZkVerifierRejectionDemo.js');

function privateKeyFromLabel(label) {
    for (let i = 0; i < 1000; i += 1) {
        const candidate = crypto.createHash('sha256').update(`${label}:${i}`).digest();
        if (secp.isPrivate(candidate)) return candidate;
    }
    throw new Error(`could not derive private key for ${label}`);
}

function pubkeyHex(privkey) {
    return Buffer.from(secp.pointFromScalar(privkey, true)).toString('hex');
}

function signTransferCore(core, privkey, role) {
    return {
        role,
        pubkeyHex: pubkeyHex(privkey),
        signatureHex: Buffer.from(secp.sign(SignedChannelTransfer.transferMessageHash(core), privkey)).toString('hex')
    };
}

function signedTransfer({ fromChannelAddress, toChannelAddress, amountUnits = '125000000', dependsOnTransferIds = [], nonce }, partyA, partyB) {
    const authorizedPubkeys = [pubkeyHex(partyA), pubkeyHex(partyB)].sort();
    const core = SignedChannelTransfer.normalizeTransferCore({
        fromChannelAddress,
        toChannelAddress,
        sourceColumn: 'A',
        destinationColumn: 'A',
        ownerAddress: 'tb1qtestowner00000000000000000000000000',
        propertyId: 1,
        amountUnits,
        dependsOnTransferIds,
        nonce
    });
    return {
        ...core,
        authorizedPubkeys,
        signatures: [
            signTransferCore(core, partyA, 'a'),
            signTransferCore(core, partyB, 'b')
        ]
    };
}

function fixtureEnvelope() {
    return ZkConsensus.buildZkConsensusEnvelope({
        proofHash: ZkConsensus.sha256Hex('proof-artifact'),
        programHash: ZkConsensus.sha256Hex('cairo-transition-program'),
        publicInputs: {
            batchHeight: 100,
            channelSignaturesRoot: ZkConsensus.sha256Hex('two-of-two-channel-signatures')
        },
        daBlob: {
            carrier: 'segwit-witness',
            encoding: 'json',
            value: {
                proofRef: 'witness:0',
                txCount: 2
            }
        },
        signedL1TxHex: '02000000000100',
        batchL2TxHex: '746c7a6b6261746368',
        movements: [
            {
                from: 'tb1qsource0000000000000000000000000000000',
                to: 'tb1qdest000000000000000000000000000000000',
                propertyId: 1,
                amountUnits: '125000000',
                memo: 'signed channel batch'
            }
        ]
    });
}

function fixtureStwoEnvelopeWithProofSummary() {
    const proofHash = ZkConsensus.sha256Hex('stwo-proof-bytes');
    const programHash = ZkConsensus.sha256Hex('stwo-program');
    return ZkConsensus.buildZkConsensusEnvelope({
        proofHash,
        programHash,
        publicInputs: {
            batchId: ZkConsensus.sha256Hex('batch-id'),
            stwoBindingCommitment: '0x1234'
        },
        daBlob: {
            carrier: 'snacksack-stwo-proof-run',
            encoding: 'json',
            value: {
                proofSummary: {
                    proofSha256: proofHash,
                    programSha256: programHash,
                    batchId: ZkConsensus.sha256Hex('batch-id'),
                    bindingCommitment: '0x1234'
                }
            }
        },
        signedL1TxHex: '02000000000100',
        batchL2TxHex: '746c7a6b6261746368',
        movements: [
            {
                from: 'tb1qsource0000000000000000000000000000000',
                to: 'tb1qdest000000000000000000000000000000000',
                propertyId: 1,
                amountUnits: '125000000',
                memo: 'signed channel batch'
            }
        ]
    });
}

describe('tx34 ZK batch movement draft', () => {
    test('builds and verifies a consensus envelope', () => {
        const envelope = fixtureEnvelope();
        const check = ZkConsensus.verifyZkConsensusEnvelope(envelope);
        expect(check).toEqual({ ok: true });
        expect(envelope.envelopeCore.signedL1Tx.hash).toBe(
            ZkConsensus.hashHexString(envelope.envelopeCore.signedL1Tx.hex, 'signedL1Tx.hex')
        );
        expect(envelope.envelopeCore.batchL2Tx.hash).toBe(
            ZkConsensus.hashHexString(envelope.envelopeCore.batchL2Tx.hex, 'batchL2Tx.hex')
        );
        expect(envelope.envelopeCore.publicInputs.verifierWasmHash).toBe(ZkConsensus.TLZK_RUST_WASM_V0_CODE_HASH);
        expect(envelope.verifierResult.resultCore.wasmCodeHash).toBe(ZkConsensus.TLZK_RUST_WASM_V0_CODE_HASH);
    });

    test('encodes and decodes compact tx34 anchor fields', () => {
        const envelope = fixtureEnvelope();
        const envelopeB64 = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
        const payload = Encode.encodeZkBatchMovement({
            zkEnvelope: envelope,
            envelopeRef: 'witness:0',
            envelopeB64
        });

        expect(payload.startsWith('z1|')).toBe(true);
        const decoded = Decode.decodeZkBatchMovement(payload);
        expect(decoded.zkBatchMovement).toBe(true);
        expect(decoded.envelopeId).toBe(envelope.envelopeId);
        expect(decoded.movementRoot).toBe(envelope.envelopeCore.movementRoot);
        expect(decoded.signedL1TxHash).toBe(envelope.envelopeCore.signedL1Tx.hash);
        expect(decoded.batchL2TxHash).toBe(envelope.envelopeCore.batchL2Tx.hash);
        expect(decoded.zkEnvelope.envelopeId).toBe(envelope.envelopeId);
    });

    test('resolves a compact tx34 anchor from local DA without embedding the envelope', async () => {
        const envelope = fixtureEnvelope();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzk-da-'));
        const previousDir = process.env.TL_ZK_ENVELOPE_DIRS;
        process.env.TL_ZK_ENVELOPE_DIRS = tempDir;
        try {
            const daPath = ZkEnvelopeResolver.writeLocalEnvelopeRecord(envelope, tempDir);
            const payload = Encode.encodeZkBatchMovement({
                zkEnvelope: envelope,
                minimalAnchor: true
            });
            expect(Buffer.byteLength(`tly${payload}`, 'utf8')).toBeLessThanOrEqual(80);
            expect(payload.includes('b64:')).toBe(false);

            const decoded = Decode.decodeZkBatchMovement(payload);
            expect(decoded.version).toBe('z2');
            expect(decoded.zkEnvelope).toBe(null);
            const resolved = await ZkEnvelopeResolver.resolveEnvelopeFromParams(decoded);
            expect(resolved.source).toBe(daPath);
            expect(resolved.envelope.envelopeId).toBe(envelope.envelopeId);
            expect(ZkConsensus.verifyZkConsensusEnvelope(resolved.envelope)).toEqual({ ok: true });
        } finally {
            if (previousDir === undefined) delete process.env.TL_ZK_ENVELOPE_DIRS;
            else process.env.TL_ZK_ENVELOPE_DIRS = previousDir;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('formats hosted DA URLs for compact tx34 anchors', () => {
        const id = 'a'.repeat(64);
        expect(ZkEnvelopeResolver.remoteUrlForEnvelopeId(id, 'https://api.layerwallet.com/zk/envelopes')).toBe(
            `https://api.layerwallet.com/zk/envelopes/${id}.json`
        );
        expect(ZkEnvelopeResolver.remoteUrlForEnvelopeId(id, 'https://api.layerwallet.com/zk/{id}')).toBe(
            `https://api.layerwallet.com/zk/${id}`
        );
        expect(ZkEnvelopeResolver.remoteUrlForEnvelopeId('bad', 'https://api.layerwallet.com/zk/envelopes')).toBe('');
    });

    test('rejects tampered signed L1 transaction material', () => {
        const envelope = fixtureEnvelope();
        const tampered = JSON.parse(JSON.stringify(envelope));
        tampered.envelopeCore.signedL1Tx.hex = '03000000000100';

        const check = ZkConsensus.verifyZkConsensusEnvelope(tampered);
        expect(check.ok).toBe(false);
    });

    test('uses the pinned packaged Rust/WASM verifier interface', async () => {
        const envelope = fixtureEnvelope();
        const result = await ZkWasmVerifier.verifyEnvelope(envelope);
        expect(result.ok).toBe(true);
        expect(result.mode).toBe('rust-wasm');
        expect(result.wasmCodeHash).toBe(ZkConsensus.TLZK_RUST_WASM_V0_CODE_HASH);
    });

    test('rejects self-consistent STWO proof-summary hash mismatches', async () => {
        const envelope = fixtureStwoEnvelopeWithProofSummary();
        expect(ZkConsensus.verifyZkConsensusEnvelope(envelope)).toEqual({ ok: true });
        expect((await ZkWasmVerifier.verifyEnvelope(envelope)).ok).toBe(true);

        const tampered = RejectionDemo.mutateSemanticProofSummaryHash(envelope);
        const consensus = ZkConsensus.verifyZkConsensusEnvelope(tampered);
        expect(consensus.ok).toBe(false);
        expect(consensus.reason).toMatch(/proof summary proof hash mismatch/);

        const wasm = await ZkWasmVerifier.verifyEnvelope(tampered);
        expect(wasm.ok).toBe(false);
        expect(wasm.mode).toBe('rust-wasm');
        expect(wasm.reason).toMatch(/proof summary proof hash mismatch/);
    });

    test('materializes and hashes proof artifact bytes when required', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzk-proof-'));
        const previousProofDirs = process.env.TL_ZK_PROOF_DIRS;
        try {
            const proofPath = path.join(tempDir, 'proof.json');
            fs.writeFileSync(proofPath, JSON.stringify({ proof: 'unit-test-proof' }));
            const proofHash = ZkProofArtifactResolver.sha256File(proofPath);
            const envelope = ZkConsensus.buildZkConsensusEnvelope({
                proofHash,
                programHash: ZkConsensus.sha256Hex('stwo-program'),
                publicInputs: {
                    batchId: ZkConsensus.sha256Hex('batch-id')
                },
                daBlob: {
                    carrier: 'snacksack-stwo-proof-run',
                    encoding: 'json',
                    value: {
                        proofSummary: {
                            proofSha256: proofHash,
                            proofPath
                        }
                    }
                },
                signedL1TxHex: '02000000000100',
                batchL2TxHex: '746c7a6b6261746368',
                movements: [{
                    from: 'tb1qsource0000000000000000000000000000000',
                    to: 'tb1qdest000000000000000000000000000000000',
                    propertyId: 1,
                    amountUnits: '125000000'
                }]
            });
            process.env.TL_ZK_PROOF_DIRS = tempDir;
            const binding = ZkProofArtifactResolver.verifyProofArtifactBinding(envelope);
            expect(binding.ok).toBe(true);
            expect(binding.observedHash).toBe(proofHash);

            const wasm = await ZkWasmVerifier.verifyEnvelope(envelope, { requireProofArtifact: true });
            expect(wasm.ok).toBe(true);
            expect(wasm.proofArtifact.ok).toBe(true);
            expect(wasm.proofArtifact.expectedHash).toBe(proofHash);
        } finally {
            if (previousProofDirs === undefined) delete process.env.TL_ZK_PROOF_DIRS;
            else process.env.TL_ZK_PROOF_DIRS = previousProofDirs;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('fails closed when strict cryptographic STWO verification has no verifier command', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzk-proof-'));
        const previousProofDirs = process.env.TL_ZK_PROOF_DIRS;
        const previousRemoteHost = process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
        const previousLocalBin = process.env.TL_ZK_STWO_VERIFY_BIN;
        const previousDisableEmbedded = process.env.TL_ZK_DISABLE_EMBEDDED_STWO;
        try {
            delete process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
            delete process.env.TL_ZK_STWO_VERIFY_BIN;
            process.env.TL_ZK_DISABLE_EMBEDDED_STWO = '1';
            const proofPath = path.join(tempDir, 'proof.json');
            fs.writeFileSync(proofPath, JSON.stringify({ fake: 'proof' }));
            const proofHash = ZkProofArtifactResolver.sha256File(proofPath);
            const envelope = ZkConsensus.buildZkConsensusEnvelope({
                proofHash,
                programHash: ZkConsensus.sha256Hex('stwo-program'),
                publicInputs: {
                    batchId: ZkConsensus.sha256Hex('batch-id')
                },
                daBlob: {
                    carrier: 'snacksack-stwo-proof-run',
                    encoding: 'json',
                    value: {
                        proofSummary: {
                            proofSha256: proofHash,
                            proofPath
                        }
                    }
                },
                signedL1TxHex: '02000000000100',
                batchL2TxHex: '746c7a6b6261746368',
                movements: [{
                    from: 'tb1qsource0000000000000000000000000000000',
                    to: 'tb1qdest000000000000000000000000000000000',
                    propertyId: 1,
                    amountUnits: '125000000'
                }]
            });
            process.env.TL_ZK_PROOF_DIRS = tempDir;
            const wasm = await ZkWasmVerifier.verifyEnvelope(envelope, {
                requireProofArtifact: true,
                requireCryptographicProof: true
            });
            expect(wasm.ok).toBe(false);
            expect(wasm.proofArtifact.ok).toBe(true);
            expect(wasm.cryptographicProofVerification.mode).toBe('stwo-verifier-unavailable');
        } finally {
            if (previousProofDirs === undefined) delete process.env.TL_ZK_PROOF_DIRS;
            else process.env.TL_ZK_PROOF_DIRS = previousProofDirs;
            if (previousRemoteHost === undefined) delete process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
            else process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST = previousRemoteHost;
            if (previousLocalBin === undefined) delete process.env.TL_ZK_STWO_VERIFY_BIN;
            else process.env.TL_ZK_STWO_VERIFY_BIN = previousLocalBin;
            if (previousDisableEmbedded === undefined) delete process.env.TL_ZK_DISABLE_EMBEDDED_STWO;
            else process.env.TL_ZK_DISABLE_EMBEDDED_STWO = previousDisableEmbedded;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('accepts a strict cryptographic STWO verification command before tx34 logic', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzk-proof-'));
        const previousProofDirs = process.env.TL_ZK_PROOF_DIRS;
        const previousLocalBin = process.env.TL_ZK_STWO_VERIFY_BIN;
        const previousExtraArgs = process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON;
        const previousRemoteHost = process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
        const previousDisableEmbedded = process.env.TL_ZK_DISABLE_EMBEDDED_STWO;
        try {
            delete process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
            process.env.TL_ZK_DISABLE_EMBEDDED_STWO = '1';
            const proofPath = path.join(tempDir, 'proof.json');
            const verifierScript = path.join(tempDir, 'mock_stwo_verify.js');
            fs.writeFileSync(proofPath, JSON.stringify({ fake: 'proof' }));
            fs.writeFileSync(verifierScript, [
                "'use strict';",
                "const fs = require('fs');",
                "const proofIndex = process.argv.indexOf('--proof_path');",
                "if (proofIndex < 0 || !fs.existsSync(process.argv[proofIndex + 1])) process.exit(2);",
                "console.log('Proof verified successfully');"
            ].join('\n'));
            const proofHash = ZkProofArtifactResolver.sha256File(proofPath);
            const envelope = ZkConsensus.buildZkConsensusEnvelope({
                proofHash,
                programHash: ZkConsensus.sha256Hex('stwo-program'),
                publicInputs: {
                    batchId: ZkConsensus.sha256Hex('batch-id')
                },
                daBlob: {
                    carrier: 'snacksack-stwo-proof-run',
                    encoding: 'json',
                    value: {
                        proofSummary: {
                            proofSha256: proofHash,
                            proofPath
                        }
                    }
                },
                signedL1TxHex: '02000000000100',
                batchL2TxHex: '746c7a6b6261746368',
                movements: [{
                    from: 'tb1qsource0000000000000000000000000000000',
                    to: 'tb1qdest000000000000000000000000000000000',
                    propertyId: 1,
                    amountUnits: '125000000'
                }]
            });
            process.env.TL_ZK_PROOF_DIRS = tempDir;
            process.env.TL_ZK_STWO_VERIFY_BIN = process.execPath;
            process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON = JSON.stringify([verifierScript]);
            const wasm = await ZkWasmVerifier.verifyEnvelope(envelope, {
                requireProofArtifact: true,
                requireCryptographicProof: true
            });
            expect(wasm.ok).toBe(true);
            expect(wasm.proofArtifact.ok).toBe(true);
            expect(wasm.cryptographicProofVerification.ok).toBe(true);
            expect(wasm.cryptographicProofVerification.mode).toBe('stwo-local-verify');
            expect(wasm.cryptographicProofVerification.proofHash).toBe(proofHash);
        } finally {
            if (previousProofDirs === undefined) delete process.env.TL_ZK_PROOF_DIRS;
            else process.env.TL_ZK_PROOF_DIRS = previousProofDirs;
            if (previousLocalBin === undefined) delete process.env.TL_ZK_STWO_VERIFY_BIN;
            else process.env.TL_ZK_STWO_VERIFY_BIN = previousLocalBin;
            if (previousExtraArgs === undefined) delete process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON;
            else process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON = previousExtraArgs;
            if (previousRemoteHost === undefined) delete process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
            else process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST = previousRemoteHost;
            if (previousDisableEmbedded === undefined) delete process.env.TL_ZK_DISABLE_EMBEDDED_STWO;
            else process.env.TL_ZK_DISABLE_EMBEDDED_STWO = previousDisableEmbedded;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('accepts an embedded STWO WASM verifier before external verifier commands', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzk-proof-'));
        const previousProofDirs = process.env.TL_ZK_PROOF_DIRS;
        const previousLocalBin = process.env.TL_ZK_STWO_VERIFY_BIN;
        const previousExtraArgs = process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON;
        const previousRemoteHost = process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
        const previousWasmPackage = process.env.TL_ZK_STWO_WASM_PACKAGE;
        try {
            delete process.env.TL_ZK_STWO_VERIFY_BIN;
            delete process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON;
            delete process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
            const proofPath = path.join(tempDir, 'proof.json');
            const verifierModule = path.join(tempDir, 'mock_embedded_stwo.js');
            fs.writeFileSync(proofPath, JSON.stringify({ fake: 'proof' }));
            fs.writeFileSync(verifierModule, [
                "'use strict';",
                "module.exports.verify_stwo_cairo_proof_json = function (_proofJson, channelHash, expectedHash) {",
                "  return JSON.stringify({ ok: true, mode: 'rust-wasm-embedded-stwo', channelHash, proofHash: expectedHash });",
                "};"
            ].join('\n'));
            const proofHash = ZkProofArtifactResolver.sha256File(proofPath);
            const envelope = ZkConsensus.buildZkConsensusEnvelope({
                proofHash,
                programHash: ZkConsensus.sha256Hex('stwo-program'),
                publicInputs: {
                    batchId: ZkConsensus.sha256Hex('batch-id')
                },
                daBlob: {
                    carrier: 'snacksack-stwo-proof-run',
                    encoding: 'json',
                    value: {
                        proofSummary: {
                            proofSha256: proofHash,
                            proofPath
                        }
                    }
                },
                signedL1TxHex: '02000000000100',
                batchL2TxHex: '746c7a6b6261746368',
                movements: [{
                    from: 'tb1qsource0000000000000000000000000000000',
                    to: 'tb1qdest000000000000000000000000000000000',
                    propertyId: 1,
                    amountUnits: '125000000'
                }]
            });
            process.env.TL_ZK_PROOF_DIRS = tempDir;
            process.env.TL_ZK_STWO_WASM_PACKAGE = verifierModule;
            const wasm = await ZkWasmVerifier.verifyEnvelope(envelope, {
                requireProofArtifact: true,
                requireCryptographicProof: true
            });
            expect(wasm.ok).toBe(true);
            expect(wasm.cryptographicProofVerification.ok).toBe(true);
            expect(wasm.cryptographicProofVerification.mode).toBe('rust-wasm-embedded-stwo');
            expect(wasm.cryptographicProofVerification.proofHash).toBe(proofHash);
        } finally {
            if (previousProofDirs === undefined) delete process.env.TL_ZK_PROOF_DIRS;
            else process.env.TL_ZK_PROOF_DIRS = previousProofDirs;
            if (previousLocalBin === undefined) delete process.env.TL_ZK_STWO_VERIFY_BIN;
            else process.env.TL_ZK_STWO_VERIFY_BIN = previousLocalBin;
            if (previousExtraArgs === undefined) delete process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON;
            else process.env.TL_ZK_STWO_VERIFY_EXTRA_ARGS_JSON = previousExtraArgs;
            if (previousRemoteHost === undefined) delete process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST;
            else process.env.TL_ZK_STWO_REMOTE_VERIFY_HOST = previousRemoteHost;
            if (previousWasmPackage === undefined) delete process.env.TL_ZK_STWO_WASM_PACKAGE;
            else process.env.TL_ZK_STWO_WASM_PACKAGE = previousWasmPackage;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects a non-approved verifier WASM hash', () => {
        const envelope = fixtureEnvelope();
        envelope.envelopeCore.publicInputs.verifierWasmHash = ZkConsensus.sha256Hex('wrong-wasm');
        envelope.envelopeCore.publicInputHash = ZkConsensus.hashCanonical(envelope.envelopeCore.publicInputs);
        envelope.envelopeId = ZkConsensus.hashCanonical(envelope.envelopeCore);
        envelope.verifierResult = ZkConsensus.buildZkVerifierResult({
            verifierId: envelope.envelopeCore.verifierId,
            proofType: envelope.envelopeCore.proofType,
            envelopeId: envelope.envelopeId,
            proofHash: envelope.envelopeCore.proofHash,
            programHash: envelope.envelopeCore.programHash,
            publicInputHash: envelope.envelopeCore.publicInputHash,
            daBlobHash: envelope.envelopeCore.publicInputs.daBlobHash
        });

        const check = ZkConsensus.verifyZkConsensusEnvelope(envelope);
        expect(check.ok).toBe(false);
        expect(check.reason).toMatch(/WASM hash/);
    });

    test('binds signed channel execution roots into the envelope', async () => {
        const partyA = privateKeyFromLabel('test-channel-party-a');
        const partyB = privateKeyFromLabel('test-channel-party-b');
        const authorizedPubkeys = [pubkeyHex(partyA), pubkeyHex(partyB)].sort();
        const core = SignedChannelTransfer.normalizeTransferCore({
            fromChannelAddress: 'tb1qtestsource00000000000000000000000000',
            toChannelAddress: 'tb1qtestdest000000000000000000000000000',
            sourceColumn: 'A',
            destinationColumn: 'A',
            ownerAddress: 'tb1qtestowner00000000000000000000000000',
            propertyId: 1,
            amountUnits: '125000000',
            nonce: 'unit-test'
        });
        const signedBatch = SignedChannelTransfer.normalizeSignedChannelTransferBatch({
            kind: SignedChannelTransfer.SIGNED_CHANNEL_TRANSFER_PROTOCOL,
            nonce: 'unit-test-batch',
            transfers: [{
                ...core,
                authorizedPubkeys,
                signatures: [
                    signTransferCore(core, partyA, 'a'),
                    signTransferCore(core, partyB, 'b')
                ]
            }]
        });
        const execution = SignedChannelTransfer.buildSignedChannelTransferExecution(signedBatch, {
            [core.fromChannelAddress]: { channel: core.fromChannelAddress, A: { 1: 5 }, B: {}, participants: { A: core.ownerAddress, B: '' } },
            [core.toChannelAddress]: { channel: core.toChannelAddress, A: { 1: 0 }, B: {}, participants: { A: core.ownerAddress, B: '' } }
        });
        const envelope = ZkConsensus.buildZkConsensusEnvelope({
            proofHash: ZkConsensus.sha256Hex('signed-channel-proof'),
            programHash: ZkConsensus.sha256Hex('signed-channel-program'),
            publicInputs: {
                signedChannelTransferBatchHash: ZkConsensus.hashCanonical(signedBatch),
                signedChannelTransferExecutionHash: ZkConsensus.hashCanonical(execution),
                channelSignatureRoot: signedBatch.batchCore.signatureRoot,
                channelInputStateRoot: execution.executionCore.inputStateRoot,
                channelOutputStateRoot: execution.executionCore.outputStateRoot,
                channelBalanceTransitionRoot: execution.executionCore.balanceTransitionRoot,
                channelAuthorizationRoot: execution.executionCore.authorizationRoot,
                channelConservationRoot: execution.executionCore.conservationRoot
            },
            daBlob: {
                carrier: 'unit-test',
                encoding: 'json',
                value: {
                    signedChannelTransferBatch: signedBatch,
                    signedChannelTransferExecution: execution
                }
            },
            signedL1TxHex: '02000000000100',
            batchL2TxHex: Buffer.from(JSON.stringify(signedBatch), 'utf8').toString('hex'),
            movements: [{
                from: `channel:${core.fromChannelAddress}:A`,
                to: `channel:${core.toChannelAddress}:A`,
                propertyId: 1,
                amountUnits: '125000000',
                memo: 'signed-channel-transfer:test'
            }]
        });

        expect(ZkConsensus.verifyZkConsensusEnvelope(envelope)).toEqual({ ok: true });
        expect(SignedChannelTransfer.assertEnvelopeBindsBatch(envelope, signedBatch).batchHash).toBe(
            envelope.envelopeCore.publicInputs.signedChannelTransferBatchHash
        );
        expect(SignedChannelTransfer.assertEnvelopeBindsExecution(envelope, signedBatch, execution).executionHash).toBe(
            envelope.envelopeCore.publicInputs.signedChannelTransferExecutionHash
        );
        const wasmResult = await ZkWasmVerifier.verifyEnvelope(envelope);
        expect(wasmResult.ok).toBe(true);

        const tampered = JSON.parse(JSON.stringify(execution));
        tampered.outputRows[0].balanceUnits = '1';
        expect(() => SignedChannelTransfer.assertEnvelopeBindsExecution(envelope, signedBatch, tampered)).toThrow(
            /execution witness mismatch/
        );
    });

    test('rejects out-of-order descendant channel transfers', () => {
        const partyA = privateKeyFromLabel('test-descendant-party-a');
        const partyB = privateKeyFromLabel('test-descendant-party-b');
        const first = signedTransfer({
            fromChannelAddress: 'tb1qdescsource0000000000000000000000000',
            toChannelAddress: 'tb1qdescrelay00000000000000000000000000',
            nonce: 'descendant-first'
        }, partyA, partyB);
        const firstId = SignedChannelTransfer.normalizeSignedTransfer(first, 0).transferId;
        const second = signedTransfer({
            fromChannelAddress: 'tb1qdescrelay00000000000000000000000000',
            toChannelAddress: 'tb1qdescdest000000000000000000000000000',
            dependsOnTransferIds: [firstId],
            nonce: 'descendant-second'
        }, partyA, partyB);
        const outOfOrderBatch = SignedChannelTransfer.normalizeSignedChannelTransferBatch({
            kind: SignedChannelTransfer.SIGNED_CHANNEL_TRANSFER_PROTOCOL,
            nonce: 'bad-descendant-order',
            transfers: [second, first]
        });

        expect(() => SignedChannelTransfer.buildSignedChannelTransferExecution(outOfOrderBatch, {
            tb1qdescsource0000000000000000000000000: {
                channel: 'tb1qdescsource0000000000000000000000000',
                A: { 1: 5 },
                B: {},
                participants: { A: 'tb1qtestowner00000000000000000000000000', B: '' }
            },
            tb1qdescrelay00000000000000000000000000: {
                channel: 'tb1qdescrelay00000000000000000000000000',
                A: { 1: 0 },
                B: {},
                participants: { A: 'tb1qtestowner00000000000000000000000000', B: '' }
            },
            tb1qdescdest000000000000000000000000000: {
                channel: 'tb1qdescdest000000000000000000000000000',
                A: { 1: 0 },
                B: {},
                participants: { A: 'tb1qtestowner00000000000000000000000000', B: '' }
            }
        })).toThrow(/unknown or future transfer/);
    });
});
