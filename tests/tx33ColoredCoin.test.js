const Encode = require('../src/txEncoder');
const Decode = require('../src/txDecoder');
const ColoredCoin = require('../src/coloredCoin');
const Validity = require('../src/validity');
const Activation = require('../src/activation');

function makeDeps({ startingBalance = 1000 } = {}) {
    const ledger = new Map([['alice:77', Number(startingBalance)]]);
    const docs = new Map();
    const updates = [];

    const getBal = (addr, pid) => Number(ledger.get(`${addr}:${pid}`) || 0);
    const setBal = (addr, pid, value) => ledger.set(`${addr}:${pid}`, Number(value || 0));

    const coloredDb = {
        findOneAsync: jest.fn(async (query) => docs.get(query?._id) || null),
        updateAsync: jest.fn(async (query, update) => {
            const id = query?._id || update?._id;
            const prev = docs.get(id) || { _id: id };
            const next = update && update.$set ? { ...prev, ...update.$set } : { ...prev, ...(update || {}) };
            docs.set(id, next);
            return 1;
        })
    };

    const deps = {
        db: {
            getDatabase: jest.fn(async (name) => {
                if (name !== 'coloredCoins') throw new Error(`unexpected db ${name}`);
                return coloredDb;
            })
        },
        TallyMap: {
            hasSufficientBalance: jest.fn(async (addr, pid, amount) => ({
                hasSufficient: getBal(addr, pid) >= Number(amount || 0),
                reason: 'insufficient'
            })),
            updateBalance: jest.fn(async (addr, pid, delta) => {
                updates.push([addr, pid, delta]);
                setBal(addr, pid, getBal(addr, pid) + Number(delta || 0));
            })
        },
        PropertyManager: {
            getPropertyData: jest.fn(async () => ({
                ticker: 'sUSD-BTCUSD-PERP',
                type: 5,
                totalInCirculation: 1000000
            }))
        }
    };

    return { deps, docs, updates, getBal };
}

describe('tx33 hybrid colored coin prototype', () => {
    beforeEach(() => {
        jest.spyOn(Activation.getInstance(), 'isTxTypeActive').mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('encodes and decodes extended tx33 TAP/RFQ fields', () => {
        const payload = Encode.encodeColoredCoin({
            encodeDecodeRecode: 1,
            propertyId: 77,
            amount: 25.5,
            satsRatio: 1000,
            homeAddress: 'tap-home',
            coloredOutputRef: 'a'.repeat(64) + ':0',
            tapAssetId: 'tap-asset-id',
            proofRoot: 'proof-root',
            rfqId: 'rfq-1',
            bitvmStatusRef: 'bitvm-lease-1'
        });
        const decoded = Decode.decodeColoredCoin(payload);

        expect(decoded.encodeDecodeRecode).toBe(1);
        expect(decoded.propertyId).toBe(77);
        expect(decoded.amount).toBe(25.5);
        expect(decoded.satsRatio).toBe(1000);
        expect(decoded.homeAddress).toBe('tap-home');
        expect(decoded.tapAssetId).toBe('tap-asset-id');
        expect(decoded.rfqId).toBe('rfq-1');
        expect(decoded.bitvmStatusRef).toBe('bitvm-lease-1');
    });

    test('encode debits TL synthetic balance and records colored commitment', async () => {
        const { deps, getBal, docs } = makeDeps();
        const record = await ColoredCoin.processColoredCoin(
            {
                encodeDecodeRecode: 1,
                senderAddress: 'alice',
                propertyId: 77,
                amount: 25,
                satsRatio: 1000,
                homeAddress: 'tap-home',
                coloredOutputRef: 'b'.repeat(64) + ':1',
                tapAssetId: 'tap-susd',
                proofRoot: 'tap-proof-root',
                rfqId: 'rfq-stablecoin-ln',
                bitvmStatusRef: 'lease-bundle',
                txid: 'encode-tx',
                block: 10
            },
            deps
        );

        expect(record.status).toBe('encoded');
        expect(record.propertyType).toBe(5);
        expect(getBal('alice', 77)).toBe(975);
        expect(docs.get(`colored::${record.commitmentId}`)).toBeTruthy();
        expect(docs.get(`colored-output::${record.currentOutputRef}`).commitmentId).toBe(record.commitmentId);
    });

    test('validity requires tx33 encode to bind a concrete reference output', async () => {
        const invalid = await Validity.validateColoredCoin('alice', {
            encodeDecodeRecode: 1,
            propertyId: 77,
            amount: 25,
            coloredOutputRef: '',
            reference: []
        }, 'f'.repeat(64));

        expect(invalid.valid).toBe(false);
        expect(invalid.reason).toMatch(/requires a concrete reference output/);

        const valid = await Validity.validateColoredCoin('alice', {
            encodeDecodeRecode: 1,
            propertyId: 77,
            amount: 25,
            coloredOutputRef: '1',
            tapAssetId: 'tap-susd',
            reference: [
                {
                    vout: 1,
                    satoshis: 10000,
                    address: 'tb1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqqenm',
                    scriptType: 'witness_v1_taproot'
                }
            ]
        }, 'f'.repeat(64));

        expect(valid.valid).toBe(true);
        expect(valid.referenceOutput.vout).toBe(1);
        expect(valid.referenceOutput.satoshis).toBe(10000);
    });

    test('validity rejects TAP hybrid references that are not P2TR', async () => {
        const checked = await Validity.validateColoredCoin('alice', {
            encodeDecodeRecode: 2,
            propertyId: 77,
            amount: 25,
            coloredOutputRef: '1',
            newColoredOutputRef: '1',
            tapAssetId: 'tap-susd',
            reference: [
                {
                    vout: 1,
                    satoshis: 10000,
                    address: 'tb1q6y5kxa8r098kvddelt3yjdcj9juqrsr526tg3q',
                    scriptType: 'witness_v0_keyhash'
                }
            ]
        }, 'f'.repeat(64));

        expect(checked.valid).toBe(false);
        expect(checked.reason).toMatch(/must be P2TR/);
    });

    test('numeric tx33 output refs become txid:vout records when processed', async () => {
        const { deps } = makeDeps();
        const record = await ColoredCoin.processColoredCoin(
            {
                encodeDecodeRecode: 1,
                senderAddress: 'alice',
                propertyId: 77,
                amount: 25,
                coloredOutputRef: '1',
                txid: 'a'.repeat(64),
                block: 10
            },
            deps
        );

        expect(record.currentOutputRef).toBe(`${'a'.repeat(64)}:1`);
    });


    test('decode credits the target exactly once', async () => {
        const { deps, getBal } = makeDeps();
        const encoded = await ColoredCoin.processColoredCoin(
            {
                encodeDecodeRecode: 1,
                senderAddress: 'alice',
                propertyId: 77,
                amount: 10,
                satsRatio: 1000,
                homeAddress: 'alice',
                coloredOutputRef: 'c'.repeat(64) + ':0',
                txid: 'encode-tx',
                block: 10
            },
            deps
        );

        const decoded = await ColoredCoin.processColoredCoin(
            {
                encodeDecodeRecode: 0,
                senderAddress: 'alice',
                propertyId: 77,
                commitmentId: encoded.commitmentId,
                homeAddress: 'alice',
                txid: 'decode-tx',
                block: 11
            },
            deps
        );

        expect(decoded.status).toBe('decoded');
        expect(getBal('alice', 77)).toBe(1000);
        await expect(
            ColoredCoin.processColoredCoin(
                {
                    encodeDecodeRecode: 0,
                    senderAddress: 'alice',
                    propertyId: 77,
                    commitmentId: encoded.commitmentId,
                    txid: 'decode-again',
                    block: 12
                },
                deps
            )
        ).rejects.toThrow(/already decoded/);
    });

    test('recode updates output reference without moving TL balance', async () => {
        const { deps, getBal } = makeDeps();
        const encoded = await ColoredCoin.processColoredCoin(
            {
                encodeDecodeRecode: 1,
                senderAddress: 'alice',
                propertyId: 77,
                amount: 5,
                satsRatio: 1000,
                coloredOutputRef: 'd'.repeat(64) + ':0',
                txid: 'encode-tx',
                block: 10
            },
            deps
        );

        const recoded = await ColoredCoin.processColoredCoin(
            {
                encodeDecodeRecode: 2,
                senderAddress: 'alice',
                propertyId: 77,
                commitmentId: encoded.commitmentId,
                newColoredOutputRef: 'e'.repeat(64) + ':2',
                proofRoot: 'repair-proof',
                txid: 'recode-tx',
                block: 11
            },
            deps
        );

        expect(recoded.status).toBe('recoded');
        expect(recoded.currentOutputRef).toBe('e'.repeat(64) + ':2');
        expect(getBal('alice', 77)).toBe(995);
        expect(recoded.history.map((entry) => entry.op)).toEqual(['encode', 'recode']);
    });
});
