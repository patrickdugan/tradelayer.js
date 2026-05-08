'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.join(__dirname, '..');
const defaultArtifactDir = path.join(repoRoot, 'artifacts', 'zk_signed_channel_transfer');
const defaultFixture = path.join(defaultArtifactDir, 'signed_channel_transfer_fixture_latest.json');

function parseArgs(argv) {
    const args = { fixture: defaultFixture, proofRun: '' };
    for (const arg of argv) {
        if (arg.startsWith('--fixture=')) args.fixture = arg.slice('--fixture='.length);
        else if (arg.startsWith('--proof-run=')) args.proofRun = arg.slice('--proof-run='.length);
    }
    return args;
}

function newestProofRun() {
    const roots = [
        path.join(repoRoot, 'artifacts', 'snacksack_proof_runs'),
        path.join('C:', 'projects', 'TLZK', 'artifacts', 'snacksack_proof_runs')
    ];
    const entries = roots
        .filter((root) => fs.existsSync(root))
        .flatMap((root) => fs.readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(root, entry.name)))
        .filter((entryPath) => fs.existsSync(path.join(entryPath, 'receipts.tgz')))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (entries.length === 0) throw new Error('no snacksack proof run receipts found');
    return entries[0];
}

function readProofSummary(proofRun) {
    const runDir = path.resolve(proofRun || newestProofRun());
    let summaryPath = path.join(runDir, 'tlzk_stwo', 'summary.json');
    if (!fs.existsSync(summaryPath)) {
        const receipts = path.join(runDir, 'receipts.tgz');
        if (!fs.existsSync(receipts)) throw new Error(`missing receipts.tgz in ${runDir}`);
        const extracted = path.join(runDir, 'extracted');
        fs.mkdirSync(extracted, { recursive: true });
        childProcess.execFileSync('tar', ['-xzf', receipts, '-C', extracted], { stdio: 'ignore' });
        summaryPath = path.join(extracted, 'tlzk_stwo', 'summary.json');
    }
    if (!fs.existsSync(summaryPath)) throw new Error(`missing proof summary in ${runDir}`);
    return {
        runDir,
        summaryPath,
        summary: JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    };
}

function hexJson(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const runId = `zk-channel-transfer-${Date.now()}`;
    process.env.TL_SKIP_RPC_BOOT = '1';
    process.env.CHAIN = 'BTC';
    process.env.TL_FORCE_TEST = '1';
    process.env.TL_NEDB_ROOT = path.join('artifacts', 'zk_signed_channel_transfer', 'nedb', runId);

    const fixture = JSON.parse(fs.readFileSync(path.resolve(args.fixture), 'utf8'));
    const proof = readProofSummary(args.proofRun);

    const db = require('../src/db.js');
    const Activation = require('../src/activation.js');
    const Channels = require('../src/channels.js');
    const Encode = require('../src/txEncoder.js');
    const Decode = require('../src/txDecoder.js');
    const Validity = require('../src/validity.js');
    const Logic = require('../src/logic.js');
    const ZkConsensus = require('../src/zkConsensusEnvelope.js');
    const SignedChannelTransfer = require('../src/zkSignedChannelTransfer.js');

    await db.init('BTC');
    const activation = Activation.getInstance('BTC');
    await activation.activate(34, 1, ZkConsensus.sha256Hex('tx34-zk-signed-channel-transfer-live'));

    for (const [channelId, channel] of Object.entries(fixture.initialChannels)) {
        await Channels.setChannel(channelId, channel);
    }

    const proofSummary = proof.summary;
    const signedBatch = fixture.signedChannelTransferBatch;
    const signedBatchCheck = SignedChannelTransfer.verifySignedChannelTransferBatch(signedBatch);
    if (!signedBatchCheck.ok) throw new Error(signedBatchCheck.reason);

    const signedL1TxHex = hexJson({
        kind: 'bitcoin-signed-tx-carrier-placeholder',
        proofRun: path.basename(proof.runDir),
        proofSha256: proofSummary.proofSha256,
        batchId: proofSummary.batchId || fixture.cairoBatch.batchId
    });
    const envelope = ZkConsensus.buildZkConsensusEnvelope({
        proofType: 'stwo-cairo-batch-binding-v1',
        proofHash: proofSummary.proofSha256,
        programHash: proofSummary.programSha256,
        publicInputs: {
            batchId: fixture.cairoBatch.batchId,
            proofRun: path.basename(proof.runDir),
            signedChannelTransferBatchHash: fixture.signedChannelTransferBatchHash,
            channelSignatureRoot: fixture.channelSignatureRoot,
            stwoBindingCommitment: proofSummary.bindingCommitment || ''
        },
        daBlob: {
            carrier: 'snacksack-stwo-proof-run',
            encoding: 'json',
            value: {
                proofSummary,
                signedChannelTransferBatch: signedBatch
            }
        },
        signedL1TxHex,
        batchL2TxHex: fixture.batchL2TxHex,
        movements: fixture.movements
    });
    const envelopeB64 = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
    const compactPayload = Encode.encodeZkBatchMovement({
        zkEnvelope: envelope,
        envelopeRef: `snacksack:${path.basename(proof.runDir)}`,
        envelopeB64
    });
    const decoded = Decode.decodeZkBatchMovement(compactPayload);
    decoded.block = fixture.blockHeight;
    decoded.senderAddress = fixture.ownerAddress;
    decoded.txid = ZkConsensus.sha256Hex(compactPayload);

    const params = await Validity.validateZkBatchMovement(fixture.ownerAddress, decoded, decoded.txid);
    if (!params.valid) throw new Error(params.reason);
    const applied = await Logic.zkBatchMove(params);

    const finalChannels = {};
    for (const channelId of Object.keys(fixture.expectedChannels)) {
        finalChannels[channelId] = await Channels.getChannel(channelId);
    }
    const ok = JSON.stringify(finalChannels) === JSON.stringify(fixture.expectedChannels);
    if (!ok) {
        throw new Error(`final channel state mismatch: ${JSON.stringify(finalChannels)}`);
    }

    const result = {
        ok: true,
        runId,
        proofRun: proof.runDir,
        proofSummaryPath: proof.summaryPath,
        verifierMode: applied.verifierMode,
        envelopeId: envelope.envelopeId,
        txid: decoded.txid,
        batchId: fixture.cairoBatch.batchId,
        signedChannelTransferBatchHash: fixture.signedChannelTransferBatchHash,
        channelSignatureRoot: fixture.channelSignatureRoot,
        compactPayload,
        applied,
        finalChannels
    };
    fs.mkdirSync(defaultArtifactDir, { recursive: true });
    fs.writeFileSync(path.join(defaultArtifactDir, 'signed_channel_transfer_live_result_latest.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
