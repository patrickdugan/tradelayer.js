#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const ZkWasmVerifier = require('../src/zkWasmVerifier.js');
const ZkEnvelopeResolver = require('../src/zkEnvelopeResolver.js');
const ZkSignedChannelTransfer = require('../src/zkSignedChannelTransfer.js');

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

function loadRuntime() {
    process.env.TL_SKIP_RPC_BOOT = '1';
    process.env.CHAIN = 'BTC';
    process.env.TL_FORCE_TEST = '1';
    process.env.TL_NEDB_ROOT = path.join('artifacts', 'zk_signed_channel_transfer', 'nedb', `verifier-rejection-${Date.now()}`);

    return {
        db: require('../src/db.js'),
        Activation: require('../src/activation.js'),
        Channels: require('../src/channels.js'),
        Encode: require('../src/txEncoder.js'),
        Decode: require('../src/txDecoder.js'),
        Validity: require('../src/validity.js'),
        Logic: require('../src/logic.js')
    };
}

async function bootstrapRuntime(runtime) {
    await runtime.db.init('BTC');
    const activation = runtime.Activation.getInstance('BTC');
    await activation.activate(34, 1, ZkConsensus.sha256Hex('tx34-zk-verifier-accept-reject-demo'));
}

function unitsToAmount(units) {
    return Number(BigInt(String(units || '0'))) / 100000000;
}

function ownerByChannelColumn(envelope) {
    const batch = ZkSignedChannelTransfer.extractSignedChannelTransferBatch(envelope);
    const owners = new Map();
    for (const transfer of batch?.batchCore?.transfers || []) {
        const core = transfer.core || {};
        if (core.fromChannelAddress && core.sourceColumn) {
            owners.set(`${core.fromChannelAddress}:${core.sourceColumn}`, String(core.ownerAddress || ''));
        }
        if (core.toChannelAddress && core.destinationColumn) {
            owners.set(`${core.toChannelAddress}:${core.destinationColumn}`, String(core.ownerAddress || ''));
        }
    }
    return owners;
}

async function primeChannelsFromExecution(runtime, envelope) {
    const execution = ZkSignedChannelTransfer.extractSignedChannelTransferExecution(envelope);
    if (!execution?.inputRows) return { primed: false, channels: [] };
    const owners = ownerByChannelColumn(envelope);
    const channels = new Map();
    for (const row of execution.inputRows) {
        const channel = channels.get(row.channelAddress) || {
            channel: row.channelAddress,
            participants: { A: '', B: '' },
            A: {},
            B: {},
            commits: []
        };
        channel[row.column] = channel[row.column] || {};
        channel[row.column][row.propertyId] = unitsToAmount(row.balanceUnits);
        channel.participants[row.column] = owners.get(`${row.channelAddress}:${row.column}`) || channel.participants[row.column] || '';
        channels.set(row.channelAddress, channel);
    }
    for (const [channelId, channel] of channels.entries()) {
        await runtime.Channels.setChannel(channelId, channel);
    }
    return { primed: true, channels: [...channels.keys()] };
}

async function outputRowsMatchChannels(runtime, envelope) {
    const execution = ZkSignedChannelTransfer.extractSignedChannelTransferExecution(envelope);
    const mismatches = [];
    for (const row of execution?.outputRows || []) {
        const channel = await runtime.Channels.getChannel(row.channelAddress);
        const observed = Math.round(Number(channel?.[row.column]?.[row.propertyId] || 0) * 100000000).toString();
        if (observed !== String(row.balanceUnits)) {
            mismatches.push({
                key: row.key,
                expectedUnits: String(row.balanceUnits),
                observedUnits: observed
            });
        }
    }
    return { ok: mismatches.length === 0, mismatches };
}

async function withCaseDa(envelope, callback) {
    const previousDirs = process.env.TL_ZK_ENVELOPE_DIRS;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzk-case-da-'));
    const daPath = ZkEnvelopeResolver.writeLocalEnvelopeRecord(envelope, tempDir);
    process.env.TL_ZK_ENVELOPE_DIRS = tempDir;
    try {
        return await callback({
            daPath,
            logicalSource: `ephemeral-case-da:${envelope.envelopeId}.json`
        });
    } finally {
        if (previousDirs === undefined) delete process.env.TL_ZK_ENVELOPE_DIRS;
        else process.env.TL_ZK_ENVELOPE_DIRS = previousDirs;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function evaluateTxConsensus(runtime, envelope, applyIfValid = true) {
    return withCaseDa(envelope, async ({ logicalSource }) => {
        const compactPayload = runtime.Encode.encodeZkBatchMovement({
            zkEnvelope: envelope,
            minimalAnchor: true
        });
        const decoded = runtime.Decode.decodeZkBatchMovement(compactPayload);
        decoded.block = 777002;
        decoded.senderAddress = envelope.envelopeCore.daBlob?.value?.signedChannelTransferBatch?.batchCore?.transfers?.[0]?.core?.ownerAddress || '';
        decoded.txid = ZkConsensus.sha256Hex(compactPayload);

        const validity = await runtime.Validity.validateZkBatchMovement(decoded.senderAddress, decoded, decoded.txid);
        const receipt = {
            compactPayload,
            txid: decoded.txid,
            daSource: logicalSource,
            validity: {
                valid: Boolean(validity.valid),
                reason: validity.reason || '',
                envelopeSource: validity.zkEnvelopeSource ? logicalSource : ''
            },
            logicApplied: false,
            blockedBeforeLogic: !validity.valid
        };

        if (!validity.valid || !applyIfValid) return receipt;

        receipt.primedChannels = await primeChannelsFromExecution(runtime, envelope);
        receipt.application = await runtime.Logic.zkBatchMove(validity);
        receipt.logicApplied = true;
        receipt.blockedBeforeLogic = false;
        receipt.outputRowsMatch = await outputRowsMatchChannels(runtime, envelope);
        return receipt;
    });
}

async function evaluateCase(name, envelope, runtime, note = '') {
    const consensus = ZkConsensus.verifyZkConsensusEnvelope(envelope);
    const wasm = await ZkWasmVerifier.verifyEnvelope(envelope);
    const txConsensus = await evaluateTxConsensus(runtime, envelope, true);
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
        registeredVerifier: wasm,
        txConsensus
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

    const runtime = loadRuntime();
    await bootstrapRuntime(runtime);

    const accepted = await evaluateCase(
        'accepted_current_envelope',
        resolved.envelope,
        runtime,
        'registered verifier approves the current DA blob/proof hash binding'
    );
    const semanticMismatch = await evaluateCase(
        'rejected_self_consistent_proof_summary_mismatch',
        mutateSemanticProofSummaryHash(resolved.envelope),
        runtime,
        'DA blob is rehashed into a self-consistent envelope, but proofSummary.proofSha256 no longer equals envelopeCore.proofHash'
    );
    const rawBlobMismatch = await evaluateCase(
        'rejected_raw_da_blob_mutation',
        mutateRawDaBlob(resolved.envelope),
        runtime,
        'DA blob changed without rebuilding the envelope id/public inputs'
    );
    const verifierMismatch = await evaluateCase(
        'rejected_unregistered_verifier_hash',
        mutateVerifierHash(resolved.envelope),
        runtime,
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
        accepted: accepted.consensus.ok && accepted.registeredVerifier.ok && accepted.txConsensus.logicApplied,
        rejected: result.cases.slice(1).map((item) => ({
            name: item.name,
            consensusOk: item.consensus.ok,
            verifierOk: item.registeredVerifier.ok,
            validityOk: item.txConsensus.validity.valid,
            logicApplied: item.txConsensus.logicApplied,
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
    loadRuntime,
    bootstrapRuntime,
    evaluateCase,
    evaluateTxConsensus
};
