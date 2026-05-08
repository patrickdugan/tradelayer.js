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
const DEST_CHANNEL = 'tb1qzkchan2000000000000000000000000000000';
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
        supportLevel: 'signed-channel-transfer-execution-binding',
        economicMutation: true,
        signedChannelTransferBatchHash: signedBatchHash
    };
    return {
        kind: 'tlzk_transition_receipt',
        receiptId: ZkConsensus.hashCanonical(receiptCore),
        receiptCore
    };
}

function main() {
    const partyA = privateKeyFromLabel('tl-zk-channel-party-a');
    const partyB = privateKeyFromLabel('tl-zk-channel-party-b');
    const authorizedPubkeys = [pubkeyHex(partyA), pubkeyHex(partyB)].sort();
    const transferCore = SignedChannelTransfer.normalizeTransferCore({
        fromChannelAddress: SOURCE_CHANNEL,
        toChannelAddress: DEST_CHANNEL,
        sourceColumn: 'A',
        destinationColumn: 'A',
        ownerAddress: OWNER_ADDRESS,
        propertyId: PROPERTY_ID,
        amountUnits: AMOUNT_UNITS,
        nonce: 'signed-channel-transfer-demo-20260508'
    });
    const signedBatchRaw = {
        kind: SignedChannelTransfer.SIGNED_CHANNEL_TRANSFER_PROTOCOL,
        nonce: 'tx22-signed-transfer-demo-20260508',
        transfers: [{
            ...transferCore,
            authorizedPubkeys,
            signatures: [
                signTransferCore(transferCore, partyA, 'channel-party-a'),
                signTransferCore(transferCore, partyB, 'channel-party-b')
            ]
        }]
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
        memo: 'signed-channel-transfer:tx22'
    };
    const witnessRows = [{
        namespace: 'channels',
        key: `${SOURCE_CHANNEL}:A:${PROPERTY_ID}`,
        oldValue: '500000000',
        newValue: '375000000'
    }, {
        namespace: 'channels',
        key: `${DEST_CHANNEL}:A:${PROPERTY_ID}`,
        oldValue: '0',
        newValue: '125000000'
    }];
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
        channelSignatureRoot: normalizedBatch.batchCore.signatureRoot
    }, null, 2));
}

main();
