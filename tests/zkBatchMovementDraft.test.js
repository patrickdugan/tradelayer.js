'use strict';

const Encode = require('../src/txEncoder.js');
const Decode = require('../src/txDecoder.js');
const ZkConsensus = require('../src/zkConsensusEnvelope.js');
const ZkWasmVerifier = require('../src/zkWasmVerifier.js');

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

    test('rejects tampered signed L1 transaction material', () => {
        const envelope = fixtureEnvelope();
        const tampered = JSON.parse(JSON.stringify(envelope));
        tampered.envelopeCore.signedL1Tx.hex = '03000000000100';

        const check = ZkConsensus.verifyZkConsensusEnvelope(tampered);
        expect(check.ok).toBe(false);
    });

    test('uses the packaged verifier interface or deterministic JS fallback', async () => {
        const envelope = fixtureEnvelope();
        const result = await ZkWasmVerifier.verifyEnvelope(envelope);
        expect(result.ok).toBe(true);
        expect(result.mode).toMatch(/rust-wasm|js-consensus-fallback/);
    });
});
