'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BigNumber = require('bignumber.js');
const secp = require('tiny-secp256k1');
const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const SignedChannelTransfer = require('../src/zkSignedChannelTransfer.js');

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'zk_signed_channel_transfer');
const DEFAULT_PROPERTY_ID = 1;
const DEFAULT_AMOUNT_UNITS = '125000000';
const DEFAULT_INITIAL_UNITS = '500000000';
const SOURCE_CHANNEL = 'tb1qzkchan000000000000000000000000000000';
const RELAY_CHANNEL_A = 'tb1qzkrelay10000000000000000000000000000';
const RELAY_CHANNEL_B = 'tb1qzkrelay20000000000000000000000000000';
const DEST_CHANNEL = 'tb1qzkdest000000000000000000000000000000';
const OWNER_ADDRESS = 'tb1qzkowner000000000000000000000000000000';
const BLOCK_HEIGHT = 777001;

function parseArgs(argv) {
    const args = {
        outDir: OUT_DIR,
        propertyId: DEFAULT_PROPERTY_ID,
        amountUnits: DEFAULT_AMOUNT_UNITS,
        initialUnits: DEFAULT_INITIAL_UNITS,
        userPrivkeyHex: process.env.TL_ZK_CHANNEL_USER_PRIVKEY_HEX || '',
        operatorPrivkeyHex: process.env.TL_ZK_CHANNEL_OPERATOR_PRIVKEY_HEX || ''
    };
    for (const arg of argv) {
        if (arg.startsWith('--out-dir=')) args.outDir = path.resolve(arg.slice('--out-dir='.length));
        else if (arg.startsWith('--property-id=')) args.propertyId = Number(arg.slice('--property-id='.length));
        else if (arg.startsWith('--amount-units=')) args.amountUnits = arg.slice('--amount-units='.length);
        else if (arg.startsWith('--initial-units=')) args.initialUnits = arg.slice('--initial-units='.length);
        else if (arg.startsWith('--user-privkey-hex=')) args.userPrivkeyHex = arg.slice('--user-privkey-hex='.length);
        else if (arg.startsWith('--operator-privkey-hex=')) args.operatorPrivkeyHex = arg.slice('--operator-privkey-hex='.length);
    }
    if (!Number.isSafeInteger(args.propertyId) || args.propertyId <= 0) throw new Error('property id must be a positive integer');
    SignedChannelTransfer.amountValueToUnits(new BigNumber(args.initialUnits).div(1e8), 'initialUnits');
    return args;
}

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

function privateKeyFromHexOrLabel(hex, label) {
    const text = String(hex || '').trim().toLowerCase();
    if (!text) return { key: privateKeyFromLabel(label), source: `deterministic:${label}` };
    if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`${label} private key must be 32-byte hex`);
    const key = Buffer.from(text, 'hex');
    if (!secp.isPrivate(key)) throw new Error(`${label} private key is not a valid secp256k1 scalar`);
    return { key, source: 'env-or-cli' };
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
        messageHash: digest.toString('hex'),
        signatureHex: Buffer.from(secp.sign(digest, privkey)).toString('hex')
    };
}

function buildReceipt({
    txid,
    oldStateRoot,
    newStateRoot,
    payloadHash,
    witnessRoot,
    signedBatchHash,
    channelPathIntentHash,
    channelPathSigningTranscriptHash
}) {
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
        supportLevel: 'signed-channel-transfer-user-path-descendant-binding',
        economicMutation: true,
        signedChannelTransferBatchHash: signedBatchHash,
        channelPathIntentHash,
        channelPathSigningTranscriptHash
    };
    return {
        kind: 'tlzk_transition_receipt',
        receiptId: ZkConsensus.hashCanonical(receiptCore),
        receiptCore
    };
}

function buildChannel(channelAddress, ownerAddress, propertyId, units) {
    const amount = SignedChannelTransfer.tokenUnitsToAmount(units).toNumber();
    return {
        channel: channelAddress,
        participants: { A: ownerAddress, B: '' },
        A: { [propertyId]: amount },
        B: {},
        commits: []
    };
}

function buildSignedChannelPath({
    propertyId,
    amountUnits,
    initialUnits,
    userKey,
    userKeySource,
    operatorKey,
    operatorKeySource
}) {
    const route = [SOURCE_CHANNEL, RELAY_CHANNEL_A, RELAY_CHANNEL_B, DEST_CHANNEL];
    const userPubkey = pubkeyHex(userKey);
    const operatorPubkey = pubkeyHex(operatorKey);
    const authorizedPubkeys = [userPubkey, operatorPubkey].sort();
    const signedTransfers = [];
    const hops = [];
    const signedMessages = [];
    let parentTransferIds = [];

    for (let index = 0; index < route.length - 1; index += 1) {
        const core = SignedChannelTransfer.normalizeTransferCore({
            fromChannelAddress: route[index],
            toChannelAddress: route[index + 1],
            sourceColumn: 'A',
            destinationColumn: 'A',
            ownerAddress: OWNER_ADDRESS,
            propertyId,
            amountUnits,
            dependsOnTransferIds: parentTransferIds,
            nonce: `user-channel-path-demo-20260508-step-${index + 1}`
        });
        const transferId = SignedChannelTransfer.transferIdForCore(core, authorizedPubkeys);
        const signatures = [
            signTransferCore(core, userKey, 'user'),
            signTransferCore(core, operatorKey, 'channel-operator')
        ];
        const signedTransfer = SignedChannelTransfer.normalizeSignedTransfer({
            ...core,
            authorizedPubkeys,
            signatures
        }, index);
        signedTransfers.push(signedTransfer);
        hops.push({
            stepIndex: index,
            transferId,
            fromChannelAddress: core.fromChannelAddress,
            toChannelAddress: core.toChannelAddress,
            propertyId,
            amountUnits,
            dependsOnTransferIds: core.dependsOnTransferIds,
            messageHash: SignedChannelTransfer.transferMessageHash(core).toString('hex')
        });
        signedMessages.push({
            stepIndex: index,
            transferId,
            messageHash: SignedChannelTransfer.transferMessageHash(core).toString('hex'),
            requiredSigners: ['user', 'channel-operator'],
            signatures
        });
        parentTransferIds = [signedTransfer.transferId];
    }

    const channelPathIntent = {
        kind: 'tl_zk_channel_path_intent_v1',
        network: 'bitcoin-testnet',
        propertyId,
        amountUnits,
        ownerAddress: OWNER_ADDRESS,
        sourceChannel: SOURCE_CHANNEL,
        relayChannels: [RELAY_CHANNEL_A, RELAY_CHANNEL_B],
        destinationChannel: DEST_CHANNEL,
        route,
        initialSourceBalanceUnits: initialUnits,
        hops,
        requiredSigners: [{
            role: 'user',
            pubkeyHex: userPubkey,
            keySource: userKeySource
        }, {
            role: 'channel-operator',
            pubkeyHex: operatorPubkey,
            keySource: operatorKeySource
        }]
    };

    const signingTranscript = {
        kind: 'tl_zk_channel_path_signing_transcript_v1',
        intentHash: ZkConsensus.hashCanonical(channelPathIntent),
        signers: channelPathIntent.requiredSigners,
        signedMessages
    };

    return {
        route,
        channelPathIntent,
        channelPathIntentHash: ZkConsensus.hashCanonical(channelPathIntent),
        signingTranscript,
        channelPathSigningTranscriptHash: ZkConsensus.hashCanonical(signingTranscript),
        signedTransfers
    };
}

function buildFixture(args) {
    const user = privateKeyFromHexOrLabel(args.userPrivkeyHex, 'tl-zk-demo-user');
    const operator = privateKeyFromHexOrLabel(args.operatorPrivkeyHex, 'tl-zk-demo-channel-operator');
    const signedPath = buildSignedChannelPath({
        propertyId: args.propertyId,
        amountUnits: args.amountUnits,
        initialUnits: args.initialUnits,
        userKey: user.key,
        userKeySource: user.source,
        operatorKey: operator.key,
        operatorKeySource: operator.source
    });
    const signedBatchRaw = {
        kind: SignedChannelTransfer.SIGNED_CHANNEL_TRANSFER_PROTOCOL,
        nonce: 'tx22-user-signed-channel-path-demo-20260508',
        transfers: signedPath.signedTransfers
    };
    const normalizedBatch = SignedChannelTransfer.normalizeSignedChannelTransferBatch(signedBatchRaw);
    const signedBatchHash = ZkConsensus.hashCanonical(normalizedBatch);

    const initialChannels = {};
    for (const channel of signedPath.route) {
        initialChannels[channel] = buildChannel(
            channel,
            OWNER_ADDRESS,
            args.propertyId,
            channel === SOURCE_CHANNEL ? args.initialUnits : '0'
        );
    }

    const expectedChannels = JSON.parse(JSON.stringify(initialChannels));
    const initialAmount = new BigNumber(args.initialUnits).div(1e8);
    const amount = SignedChannelTransfer.tokenUnitsToAmount(args.amountUnits);
    expectedChannels[SOURCE_CHANNEL].A[args.propertyId] = initialAmount.minus(amount).decimalPlaces(8).toNumber();
    expectedChannels[DEST_CHANNEL].A[args.propertyId] = amount.toNumber();

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
        propertyId: args.propertyId,
        amountUnits: args.amountUnits,
        memo: 'signed-channel-transfer:user-path-net'
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
        signedBatchHash,
        channelPathIntentHash: signedPath.channelPathIntentHash,
        channelPathSigningTranscriptHash: signedPath.channelPathSigningTranscriptHash
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

    return {
        kind: 'tl_zk_signed_channel_transfer_demo_fixture_v2',
        createdAt: new Date().toISOString(),
        network: 'bitcoin-testnet',
        blockHeight: BLOCK_HEIGHT,
        propertyId: args.propertyId,
        amountUnits: args.amountUnits,
        ownerAddress: OWNER_ADDRESS,
        userSigningDemo: {
            userPubkey: pubkeyHex(user.key),
            operatorPubkey: pubkeyHex(operator.key),
            userKeySource: user.source,
            operatorKeySource: operator.source
        },
        channelPathIntent: signedPath.channelPathIntent,
        channelPathIntentHash: signedPath.channelPathIntentHash,
        signingTranscript: signedPath.signingTranscript,
        channelPathSigningTranscriptHash: signedPath.channelPathSigningTranscriptHash,
        initialChannels,
        expectedChannels,
        signedChannelTransferBatch: normalizedBatch,
        signedChannelTransferBatchHash: signedBatchHash,
        channelSignatureRoot: normalizedBatch.batchCore.signatureRoot,
        signedChannelTransferExecution,
        signedChannelTransferExecutionHash,
        descendantChain: signedPath.channelPathIntent.hops,
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
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const fixture = buildFixture(args);
    fs.mkdirSync(args.outDir, { recursive: true });

    const fixturePath = path.join(args.outDir, 'signed_channel_transfer_fixture_latest.json');
    const batchPath = path.join(args.outDir, 'signed_channel_transfer_batch_latest.json');
    const intentPath = path.join(args.outDir, 'channel_path_intent_latest.json');
    const transcriptPath = path.join(args.outDir, 'user_signed_channel_path_latest.json');
    writeJson(fixturePath, fixture);
    writeJson(batchPath, fixture.cairoBatch);
    writeJson(intentPath, fixture.channelPathIntent);
    writeJson(transcriptPath, fixture.signingTranscript);

    console.log(JSON.stringify({
        ok: true,
        intentPath,
        transcriptPath,
        fixturePath,
        batchPath,
        batchId: fixture.cairoBatch.batchId,
        channelPathIntentHash: fixture.channelPathIntentHash,
        channelPathSigningTranscriptHash: fixture.channelPathSigningTranscriptHash,
        signedChannelTransferBatchHash: fixture.signedChannelTransferBatchHash,
        signedChannelTransferExecutionHash: fixture.signedChannelTransferExecutionHash,
        channelInputStateRoot: fixture.signedChannelTransferExecution.executionCore.inputStateRoot,
        channelOutputStateRoot: fixture.signedChannelTransferExecution.executionCore.outputStateRoot,
        channelStepRoot: fixture.signedChannelTransferExecution.executionCore.stepRoot,
        channelDescendantRoot: fixture.signedChannelTransferExecution.executionCore.descendantRoot,
        maxDependencyDepth: fixture.signedChannelTransferExecution.executionCore.maxDependencyDepth,
        channelSignatureRoot: fixture.channelSignatureRoot
    }, null, 2));
}

if (require.main === module) {
    main();
}

module.exports = {
    buildFixture
};
