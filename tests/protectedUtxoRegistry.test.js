'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ProtectedUtxos = require('../src/protectedUtxoRegistry');

const txidA = 'a'.repeat(64);
const txidB = 'b'.repeat(64);

describe('protected UTXO registry', () => {
    test('marks and filters protected protocol refs', () => {
        let registry = ProtectedUtxos.emptyRegistry('BTCTEST');
        registry = ProtectedUtxos.markProtected(registry, {
            txid: txidA,
            vout: 0,
            address: 'tb1pref',
            amountBtc: 0.00000546,
            protectionKind: 'tap-asset-ref',
            reason: 'tx33 TAP commitment carrier'
        });

        expect(ProtectedUtxos.isProtected(registry, txidA, 0)).toBe(true);
        expect(ProtectedUtxos.isProtected(registry, txidB, 0)).toBe(false);
        expect(ProtectedUtxos.filterSpendableUtxos([
            { txid: txidA, vout: 0 },
            { txid: txidB, vout: 0 }
        ], registry)).toEqual([{ txid: txidB, vout: 0 }]);
        expect(ProtectedUtxos.lockRequests(registry)).toEqual([{ txid: txidA, vout: 0 }]);
    });

    test('persists and deactivates entries', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-protected-utxos-'));
        const filePath = path.join(dir, 'registry.json');
        try {
            let registry = ProtectedUtxos.markProtected(ProtectedUtxos.emptyRegistry('BTCTEST'), {
                txid: txidA,
                vout: 2,
                protectionKind: 'dlc-bitvm-ref'
            });
            ProtectedUtxos.writeRegistry(registry, filePath);
            registry = ProtectedUtxos.loadRegistry(filePath);
            expect(ProtectedUtxos.activeEntries(registry)).toHaveLength(1);

            registry = ProtectedUtxos.unmarkProtected(registry, `${txidA}:2`);
            expect(ProtectedUtxos.activeEntries(registry)).toHaveLength(0);
            expect(registry.entries[0].status).toBe('unprotected');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('records Bitcoin Core lock state separately from protection state', () => {
        const registry = ProtectedUtxos.markProtected(ProtectedUtxos.emptyRegistry('BTCTEST'), {
            txid: txidA,
            vout: 1,
            protectionKind: 'colored-coin-ref'
        });
        const locked = ProtectedUtxos.noteBitcoinCoreLocks(registry, [{ txid: txidA, vout: 1 }]);
        expect(ProtectedUtxos.activeEntries(locked)).toHaveLength(1);
        expect(locked.entries[0].lockedByBitcoinCore).toBe(true);
        expect(locked.entries[0].lastLockedAt).toBeTruthy();
    });
});
