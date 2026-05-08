'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY_KIND = 'tradelayer_protected_utxo_registry_v1';
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'artifacts', 'protected-utxos.json');

function defaultRegistryPath() {
    return process.env.TL_PROTECTED_UTXO_REGISTRY || DEFAULT_REGISTRY_PATH;
}

function normalizeTxid(txid) {
    const text = String(txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`invalid txid: ${txid}`);
    return text;
}

function normalizeVout(vout) {
    const n = Number(vout);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid vout: ${vout}`);
    return n;
}

function outpointKey(txid, vout) {
    return `${normalizeTxid(txid)}:${normalizeVout(vout)}`;
}

function splitOutpoint(outpoint) {
    const [txid, vout] = String(outpoint || '').split(':');
    return { txid: normalizeTxid(txid), vout: normalizeVout(vout) };
}

function emptyRegistry(network = 'BTCTEST') {
    return {
        kind: REGISTRY_KIND,
        network,
        updatedAt: new Date().toISOString(),
        entries: []
    };
}

function normalizeEntry(entry = {}) {
    const txid = normalizeTxid(entry.txid);
    const vout = normalizeVout(entry.vout);
    const now = new Date().toISOString();
    return {
        txid,
        vout,
        outpoint: outpointKey(txid, vout),
        status: String(entry.status || 'protected'),
        protectionKind: String(entry.protectionKind || entry.kind || 'protocol-ref'),
        address: String(entry.address || ''),
        amountBtc: entry.amountBtc === undefined || entry.amountBtc === null || entry.amountBtc === ''
            ? null
            : Number(entry.amountBtc),
        label: String(entry.label || ''),
        commitmentId: String(entry.commitmentId || ''),
        reason: String(entry.reason || ''),
        createdAt: String(entry.createdAt || now),
        updatedAt: String(entry.updatedAt || now),
        lastLockedAt: entry.lastLockedAt || null,
        lockedByBitcoinCore: Boolean(entry.lockedByBitcoinCore),
        spentByTxid: String(entry.spentByTxid || '')
    };
}

function normalizeRegistry(registry = {}) {
    const normalized = {
        kind: REGISTRY_KIND,
        network: String(registry.network || 'BTCTEST'),
        updatedAt: String(registry.updatedAt || new Date().toISOString()),
        entries: []
    };
    const byKey = new Map();
    for (const raw of Array.isArray(registry.entries) ? registry.entries : []) {
        const entry = normalizeEntry(raw);
        byKey.set(entry.outpoint, entry);
    }
    normalized.entries = [...byKey.values()].sort((a, b) => a.outpoint.localeCompare(b.outpoint));
    return normalized;
}

function loadRegistry(filePath = defaultRegistryPath(), options = {}) {
    if (!fs.existsSync(filePath)) return emptyRegistry(options.network || 'BTCTEST');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed.kind && parsed.kind !== REGISTRY_KIND) {
        throw new Error(`unsupported protected UTXO registry kind: ${parsed.kind}`);
    }
    return normalizeRegistry(parsed);
}

function writeRegistry(registry, filePath = defaultRegistryPath()) {
    const normalized = normalizeRegistry({
        ...registry,
        updatedAt: new Date().toISOString()
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
}

function markProtected(registry, entry) {
    const normalized = normalizeRegistry(registry);
    const protectedEntry = normalizeEntry({
        ...entry,
        status: entry.status || 'protected',
        updatedAt: new Date().toISOString()
    });
    const entries = normalized.entries.filter((item) => item.outpoint !== protectedEntry.outpoint);
    entries.push(protectedEntry);
    return normalizeRegistry({
        ...normalized,
        entries
    });
}

function unmarkProtected(registry, outpointOrEntry, options = {}) {
    const normalized = normalizeRegistry(registry);
    const outpoint = typeof outpointOrEntry === 'string'
        ? outpointKey(splitOutpoint(outpointOrEntry).txid, splitOutpoint(outpointOrEntry).vout)
        : outpointKey(outpointOrEntry.txid, outpointOrEntry.vout);
    if (options.remove) {
        return normalizeRegistry({
            ...normalized,
            entries: normalized.entries.filter((entry) => entry.outpoint !== outpoint)
        });
    }
    return normalizeRegistry({
        ...normalized,
        entries: normalized.entries.map((entry) => entry.outpoint === outpoint
            ? {
                ...entry,
                status: 'unprotected',
                updatedAt: new Date().toISOString(),
                lockedByBitcoinCore: false
            }
            : entry)
    });
}

function activeEntries(registry) {
    return normalizeRegistry(registry).entries.filter((entry) => entry.status === 'protected');
}

function protectedOutpointSet(registry) {
    return new Set(activeEntries(registry).map((entry) => entry.outpoint));
}

function isProtected(registry, txid, vout) {
    return protectedOutpointSet(registry).has(outpointKey(txid, vout));
}

function filterSpendableUtxos(utxos = [], registry = emptyRegistry()) {
    const blocked = protectedOutpointSet(registry);
    return (utxos || []).filter((utxo) => !blocked.has(outpointKey(utxo.txid, utxo.vout)));
}

function protectedUtxosFromList(utxos = [], registry = emptyRegistry()) {
    const blocked = protectedOutpointSet(registry);
    return (utxos || []).filter((utxo) => blocked.has(outpointKey(utxo.txid, utxo.vout)));
}

function lockRequests(registry = emptyRegistry()) {
    return activeEntries(registry).map((entry) => ({
        txid: entry.txid,
        vout: entry.vout
    }));
}

function noteBitcoinCoreLocks(registry, lockedOutpoints = []) {
    const locked = new Set(lockedOutpoints.map((item) => typeof item === 'string'
        ? outpointKey(splitOutpoint(item).txid, splitOutpoint(item).vout)
        : outpointKey(item.txid, item.vout)));
    const now = new Date().toISOString();
    return normalizeRegistry({
        ...registry,
        entries: normalizeRegistry(registry).entries.map((entry) => locked.has(entry.outpoint)
            ? {
                ...entry,
                lockedByBitcoinCore: true,
                lastLockedAt: now,
                updatedAt: now
            }
            : entry)
    });
}

module.exports = {
    REGISTRY_KIND,
    DEFAULT_REGISTRY_PATH,
    defaultRegistryPath,
    normalizeTxid,
    normalizeVout,
    outpointKey,
    splitOutpoint,
    emptyRegistry,
    normalizeEntry,
    normalizeRegistry,
    loadRegistry,
    writeRegistry,
    markProtected,
    unmarkProtected,
    activeEntries,
    protectedOutpointSet,
    isProtected,
    filterSpendableUtxos,
    protectedUtxosFromList,
    lockRequests,
    noteBitcoinCoreLocks
};
