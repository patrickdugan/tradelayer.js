'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secp = require('tiny-secp256k1');
const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const SignedChannelTransfer = require('../src/zkSignedChannelTransfer.js');

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'zk_signed_channel_transfer');
const PROPERTY_ID = 1;
const AMOUNT_UNITS = '125000000';
const SOURCE_CHANNEL = 'tb1qzkchan000000000000000000000000000000';
const RELAY_CHANNEL_A = 'tb1qzkrelay10000000000000000000000000000';
const RELAY_CHANNEL_B = 'tb1qzkrelay20000000000000000000000000000';
const DEST_CHANNEL = 'tb1qzkdest000000000000000000000000000000';
const OWNER_ADDRESS = 'tb1qzkowner000000000000000000000000000000';
const BLOCK_HEIGHT = 777001;

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function privateKeyFromLabel(label) {
    for (let i = 0; i < 1000; i += 1) {
        const candidate = crypto.createHash('sha256').update(`${label}:${i}`).digest();
        if (secp.isPrivate(candidate)) return candidate;
    }
    throw new Error(`could not derive private key for ${label}`);
}

function hexJson(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
}

function pubkeyHex(privkey) {
    return Buffer.from(secp.pointFromScalar(privkey, true)).toString('hex');
}

function signTransferCore(core, privkey, role) {
    const digest = SignedChannelTransfer.transferMessageHash(core);
    return {
        role,
        pubkeyHex: pubkeyHex(privkey),
        signatureHex: Buffer.from(secp.sign(digest, privkey)).toString('hex')
    };
}

function buildReceipt({ txid, oldStateRoot, newStateRoot, payloadHash, witnessRoot, signedBatchHash }) {
    const receiptCore = {
        protocol: 'tl_zk_signed_channel_transfer_transition_receipt_v1',
        txid,
        txType: 22,
        blockHeight: BLOCK_HEIGHT,
        valid: true,
        oldStateRoot,
        newStateRoot,
        payloadHash,
        witnessRoot,
        supportLevel: 'signed-channel-transfer-descendant-execution-binding',
        economicMutation: true,
        signedChannelTransferBatchHash: signedBatchHash
    };
    return {
        kind: 'tlzk_transition_receipt',
        receiptId: ZkConsensus.hashCanonical(receiptCore),
        receiptCore
    };
}

function buildSignedTransfer({ fromChannelAddress, toChannelAddress, nonce, dependsOnTransferIds }, authorizedPubkeys, partyA, partyB) {
    const core = SignedChannelTransfer.normalizeTransferCore({
        fromChannelAddress,
        toChannelAddress,
        sourceColumn: 'A',
        destinationColumn: 'A',
        ownerAddress: OWNER_ADDRESS,
        propertyId: PROPERTY_ID,
        amountUnits: AMOUNT_UNITS,
        dependsOnTransferIds,
        nonce
    });
    return {
        ...core,
        authorizedPubkeys,
        signatures: [
            signTransferCore(core, partyA, 'channel-party-a'),
            signTransferCore(core, partyB, 'channel-party-b')
        ]
    };
}

function main() {
    const partyA = privateKeyFromLabel('tl-zk-channel-party-a');
    const partyB = privateKeyFromLabel('tl-zk-channel-party-b');
    const authorizedPubkeys = [pubkeyHex(partyA), pubkeyHex(partyB)].sort();
    const transfer1 = buildSignedTransfer({
        fromChannelAddress: SOURCE_CHANNEL,
        toChannelAddress: RELAY_CHANNEL_A,
        dependsOnTransferIds: [],
        nonce: 'signed-channel-transfer-demo-20260508-step-1'
    }, authorizedPubkeys, partyA, partyB);
    const transfer1Id = SignedChannelTransfer.normalizeSignedTransfer(transfer1, 0).transferId;
    const transfer2 = buildSignedTransfer({
        fromChannelAddress: RELAY_CHANNEL_A,
        toChannelAddress: RELAY_CHANNEL_B,
        dependsOnTransferIds: [transfer1Id],
        nonce: 'signed-channel-transfer-demo-20260508-step-2'
    }, authorizedPubkeys, partyA, partyB);
    const transfer2Id = SignedChannelTransfer.normalizeSignedTransfer(transfer2, 1).transferId;
    const transfer3 = buildSignedTransfer({
        fromChannelAddress: RELAY_CHANNEL_B,
        toChannelAddress: DEST_CHANNEL,
        dependsOnTransferIds: [transfer2Id],
        nonce: 'signed-channel-transfer-demo-20260508-step-3'
    }, authorizedPubkeys, partyA, partyB);
    const transfer3Id = SignedChannelTransfer.normalizeSignedTransfer(transfer3, 2).transferId;
    const descendantChain = [{
        stepIndex: 0,
        transferId: transfer1Id,
        fromChannelAddress: SOURCE_CHANNEL,
        toChannelAddress: RELAY_CHANNEL_A,
        dependsOnTransferIds: []
    }, {
        stepIndex: 1,
        transferId: transfer2Id,
        fromChannelAddress: RELAY_CHANNEL_A,
        toChannelAddress: RELAY_CHANNEL_B,
        dependsOnTransferIds: [transfer1Id]
    }, {
        stepIndex: 2,
        transferId: transfer3Id,
        fromChannelAddress: RELAY_CHANNEL_B,
        toChannelAddress: DEST_CHANNEL,
        dependsOnTransferIds: [transfer2Id]
    }];
    const signedBatchRaw = {
        kind: SignedChannelTransfer.SIGNED_CHANNEL_TRANSFER_PROTOCOL,
        nonce: 'tx22-signed-descendant-transfer-demo-20260508',
        transfers: [transfer1, transfer2, transfer3]
    };
    const normalizedBatch = SignedChannelTransfer.normalizeSignedChannelTransferBatch(signedBatchRaw);
    const signedBatchHash = ZkConsensus.hashCanonical(normalizedBatch);

    const initialChannels = {
        [SOURCE_CHANNEL]: {
            channel: SOURCE_CHANNEL,
            participants: { A: OWNER_ADDRESS, B: '' },
            A: { [PROPERTY_ID]: 5 },
            B: {},
            commits: []
        },
        [DEST_CHANNEL]: {
            channel: DEST_CHANNEL,
            participants: { A: OWNER_ADDRESS, B: '' },
            A: { [PROPERTY_ID]: 0 },
            B: {},
            commits: []
        },
        [RELAY_CHANNEL_A]: {
            channel: RELAY_CHANNEL_A,
            participants: { A: OWNER_ADDRESS, B: '' },
            A: { [PROPERTY_ID]: 0 },
            B: {},
            commits: []
        },
        [RELAY_CHANNEL_B]: {
            channel: RELAY_CHANNEL_B,
            participants: { A: OWNER_ADDRESS, B: '' },
            A: { [PROPERTY_ID]: 0 },
            B: {},
            commits: []
        }
    };
    const expectedChannels = JSON.parse(JSON.stringify(initialChannels));
    expectedChannels[SOURCE_CHANNEL].A[PROPERTY_ID] = 3.75;
    expectedChannels[DEST_CHANNEL].A[PROPERTY_ID] = 1.25;
    const signedChannelTransferExecution = SignedChannelTransfer.buildSignedChannelTransferExecution(
        normalizedBatch,
        initialChannels
    );
    const signedChannelTransferExecutionHash = ZkConsensus.hashCanonical(signedChannelTransferExecution);

    const oldStateRoot = signedChannelTransferExecution.executionCore.inputStateRoot;
    const newStateRoot = signedChannelTransferExecution.executionCore.outputStateRoot;
    const batchL2TxHex = hexJson(normalizedBatch);
    const txid = sha256Hex(batchL2TxHex);
    const movement = {
        from: `channel:${SOURCE_CHANNEL}:A`,
        to: `channel:${DEST_CHANNEL}:A`,
        propertyId: PROPERTY_ID,
        amountUnits: AMOUNT_UNITS,
        memo: 'signed-channel-transfer:descendant-net'
    };
    const outputByKey = new Map(signedChannelTransferExecution.outputRows.map((row) => [row.key, row]));
    const witnessRows = signedChannelTransferExecution.inputRows.map((row) => ({
        namespace: 'channels',
        key: row.key,
        oldValue: row.balanceUnits,
        newValue: outputByKey.get(row.key).balanceUnits
    }));
    const receipt = buildReceipt({
        txid,
        oldStateRoot,
        newStateRoot,
        payloadHash: sha256Hex(batchL2TxHex),
        witnessRoot: signedChannelTransferExecutionHash,
        signedBatchHash
    });
    const batchCore = {
        protocol: 'tlzk_aggregated_batch_checkpoint_v1',
        startHeight: BLOCK_HEIGHT,
        endHeight: BLOCK_HEIGHT,
        transitionRoot: ZkConsensus.hashCanonical([receipt.receiptId]),
        finalStateRoot: newStateRoot,
        receiptCount: 1,
        validReceiptCount: 1
    };
    const cairoBatch = {
        kind: 'tlzk_aggregated_batch_checkpoint',
        batchId: ZkConsensus.hashCanonical(batchCore),
        batchCore,
        transitionReceipts: [receipt]
    };
    const fixture = {
        kind: 'tl_zk_signed_channel_transfer_demo_fixture_v1',
        createdAt: new Date().toISOString(),
        network: 'bitcoin-testnet',
        blockHeight: BLOCK_HEIGHT,
        propertyId: PROPERTY_ID,
        amountUnits: AMOUNT_UNITS,
        ownerAddress: OWNER_ADDRESS,
        publicKeys: {
            partyA: authorizedPubkeys[0],
            partyB: authorizedPubkeys[1]
        },
        initialChannels,
        expectedChannels,
        signedChannelTransferBatch: normalizedBatch,
        signedChannelTransferBatchHash: signedBatchHash,
        channelSignatureRoot: normalizedBatch.batchCore.signatureRoot,
        signedChannelTransferExecution,
        signedChannelTransferExecutionHash,
        descendantChain,
        movements: [movement],
        batchL2TxHex,
        signedL1TxTemplateHex: hexJson({
            kind: 'bitcoin-signed-tx-carrier-placeholder',
            txid,
            note: 'testnet witness/DA carrier placeholder for tx34 proof binding'
        }),
        witnessRows,
        cairoBatch
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const fixturePath = path.join(OUT_DIR, 'signed_channel_transfer_fixture_latest.json');
    const batchPath = path.join(OUT_DIR, 'signed_channel_transfer_batch_latest.json');
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    fs.writeFileSync(batchPath, `${JSON.stringify(cairoBatch, null, 2)}\n`);
    console.log(JSON.stringify({
        ok: true,
        fixturePath,
        batchPath,
        batchId: cairoBatch.batchId,
        signedChannelTransferBatchHash: signedBatchHash,
        signedChannelTransferExecutionHash,
        channelInputStateRoot: signedChannelTransferExecution.executionCore.inputStateRoot,
        channelOutputStateRoot: signedChannelTransferExecution.executionCore.outputStateRoot,
        channelStepRoot: signedChannelTransferExecution.executionCore.stepRoot,
        channelDescendantRoot: signedChannelTransferExecution.executionCore.descendantRoot,
        maxDependencyDepth: signedChannelTransferExecution.executionCore.maxDependencyDepth,
        channelSignatureRoot: normalizedBatch.batchCore.signatureRoot
    }, null, 2));
}

main();
