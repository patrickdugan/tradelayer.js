// persistence.js
const fs = require('fs');
const path = require('path');
const db = require('./db.js');
const ConsensusDatabase = require('./consensus.js');
const ClientWrapper = require('./client.js');

class Persistence {
    static instance = null;

    constructor(options = {}) {
        if (Persistence.instance) return Persistence.instance;

        this.snapshotInterval = options.snapshotInterval || 1000;
        this.dbDir = options.dbDir || path.join(__dirname, 'db');          // adjust if needed
        this.snapshotsDir = options.snapshotsDir || path.join(__dirname, 'snapshots');

        this.client = null;
        Persistence.instance = this;
        return this;
    }

    static async getInstance(options = {}) {
        if (!Persistence.instance) {
            Persistence.instance = new Persistence(options);
            await Persistence.instance.init();
        }
        return Persistence.instance;
    }

    async init() {
        await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
        // RPC client with getBlockCount / getBlockHash / getBlock
        this.client = await ClientWrapper.getInstance(true);
    }

    // --- Block header tracking ------------------------------------------------

    async recordBlockHeader(blockHeight, blockHash, prevBlockHash) {
        const base = await db.getDatabase('persistence');
        await base.updateAsync(
            { _id: `block-${blockHeight}` },
            {
                $set: {
                    height: blockHeight,
                    hash: blockHash,
                    prevHash: prevBlockHash,
                    createdAt: Date.now()
                }
            },
            { upsert: true }
        );
    }

    async getBlockHeader(blockHeight) {
        const base = await db.getDatabase('persistence');
        return base.findOneAsync({ _id: `block-${blockHeight}` });
    }

    async getLastKnownBlock() {
        const base = await db.getDatabase('persistence');
        const docs = await base.findAsync({ height: { $exists: true } });
        if (!docs || docs.length === 0) return null;
        docs.sort((a, b) => a.height - b.height);
        return docs[docs.length - 1];
    }

    // Live “spidey sense” for a just-arrived block
    async checkForReorgForNewBlock(blockHeight, prevBlockHash) {
        if (blockHeight === 0) return false;

        const last = await this.getBlockHeader(blockHeight - 1);
        if (!last) {
            // No local record for previous block → nothing to compare
            return false;
        }

        if (last.hash !== prevBlockHash) {
            console.warn(
                `Reorg detected at height ${blockHeight}: ` +
                `stored hash for ${blockHeight - 1}=${last.hash}, ` +
                `new prevBlockHash=${prevBlockHash}`
            );
            return true;
        }
        return false;
    }

    // --- Snapshot + consensus hash -------------------------------------------

    async maybeCheckpoint(blockHeight) {
        if (this.snapshotInterval <= 0) return;
        if (blockHeight % this.snapshotInterval !== 0) return;

        // 1) Compute consensus state hash from current DB state
        const consensusStateHash = await ConsensusDatabase.stateConsensusHash();
        // 2) Record hash by height
        await ConsensusDatabase.storeConsensusHash(blockHeight, consensusStateHash);
        // 3) Snapshot DB files
        await this.createSnapshot(blockHeight, consensusStateHash);
    }

    async createSnapshot(blockHeight, consensusHash) {
        const fsP = fs.promises;
        const short = consensusHash ? consensusHash.slice(0, 12) : 'nohash';
        const dirName = `${blockHeight}-${short}`;
        const snapshotPath = path.join(this.snapshotsDir, dirName);

        await fsP.mkdir(snapshotPath, { recursive: true });

        const files = await fsP.readdir(this.dbDir);
        const copied = [];

        for (const file of files) {
            // Tweak this filter to match your NeDB or JSON filenames
            if (!file.endsWith('.db')) continue;

            const src = path.join(this.dbDir, file);
            const dst = path.join(snapshotPath, file);
            await fsP.copyFile(src, dst);
            copied.push(file);
        }

        const meta = {
            blockHeight,
            consensusHash,
            createdAt: new Date().toISOString(),
            files: copied
        };

        await fsP.writeFile(
            path.join(snapshotPath, 'meta.json'),
            JSON.stringify(meta, null, 2)
        );

        // keep only last 2 snapshots
        await this.pruneOldSnapshots(2);
        console.log(`Snapshot created at height ${blockHeight} (${dirName}).`);
    }

    async listSnapshots() {
        const fsP = fs.promises;
        try {
            const entries = await fsP.readdir(this.snapshotsDir, { withFileTypes: true });
            const dirs = entries.filter(e => e.isDirectory()).map(d => d.name);

            const snapshots = [];
            for (const dir of dirs) {
                const metaPath = path.join(this.snapshotsDir, dir, 'meta.json');
                try {
                    const raw = await fsP.readFile(metaPath, 'utf8');
                    const meta = JSON.parse(raw);
                    meta.dir = dir;
                    snapshots.push(meta);
                } catch (e) {
                    console.warn(`Snapshot ${dir} missing/invalid meta.json`);
                }
            }
            snapshots.sort((a, b) => a.blockHeight - b.blockHeight);
            return snapshots;
        } catch (e) {
            if (e.code === 'ENOENT') return [];
            throw e;
        }
    }

    async pruneOldSnapshots(keep = 2) {
        const fsP = fs.promises;
        const snaps = await this.listSnapshots();
        if (snaps.length <= keep) return;

        const toDelete = snaps.slice(0, snaps.length - keep);
        for (const snap of toDelete) {
            const dirPath = path.join(this.snapshotsDir, snap.dir);
            console.log(`Pruning old snapshot ${snap.dir}`);
            await fsP.rm(dirPath, { recursive: true, force: true });
        }
    }

    async findBestSnapshotBefore(height) {
        const snaps = await this.listSnapshots();
        if (!snaps.length) return null;

        let best = null;
        for (const s of snaps) {
            if (s.blockHeight <= height && (!best || s.blockHeight > best.blockHeight)) {
                best = s;
            }
        }
        return best;
    }

    async restoreSnapshot(snapshotMeta) {
        const fsP = fs.promises;
        const dir = path.join(this.snapshotsDir, snapshotMeta.dir);
        const files = snapshotMeta.files || (await fsP.readdir(dir));

        // Optional: backup current DB dir just in case
        const backupDir = path.join(this.dbDir, `backup-${Date.now()}`);
        await fsP.mkdir(backupDir, { recursive: true });

        const currentFiles = await fsP.readdir(this.dbDir);
        for (const f of currentFiles) {
            const src = path.join(this.dbDir, f);
            const dst = path.join(backupDir, f);
            await fsP.copyFile(src, dst);
        }

        // Clear current DB dir
        for (const f of currentFiles) {
            await fsP.rm(path.join(this.dbDir, f), { force: true });
        }

        // Restore snapshot files
        for (const f of files) {
            if (!f.endsWith('.db')) continue;
            const src = path.join(dir, f);
            const dst = path.join(this.dbDir, f);
            await fsP.copyFile(src, dst);
        }

        console.log(
            `Restored DB from snapshot ${snapshotMeta.dir} at height ${snapshotMeta.blockHeight}`
        );
    }

    // --- Offline / restart reorg detection + recovery ------------------------

    async detectAndHandleReorg() {
        const last = await this.getLastKnownBlock();
        if (!last) return null;

        const nodeHash = await this.client.getBlockHash(last.height);
        if (nodeHash === last.hash) {
            // no reorg at top height
            return null;
        }

        console.warn(
            `Top-of-chain reorg suspected: local hash at ${last.height}=${last.hash}, ` +
            `node hash=${nodeHash}`
        );

        // Walk backwards to find common ancestor
        let h = last.height;
        let ancestor = 0;

        while (h > 0) {
            const local = await this.getBlockHeader(h);
            const chainHash = await this.client.getBlockHash(h);

            if (local && local.hash === chainHash) {
                ancestor = h;
                break;
            }
            h--;
        }

        const bestSnap = await this.findBestSnapshotBefore(ancestor);
        if (bestSnap) {
            await this.restoreSnapshot(bestSnap);
            console.warn(
                `Reorg handled via snapshot at ${bestSnap.blockHeight}, ` +
                `common ancestor=${ancestor}, lastLocal=${last.height}`
            );
            return {
                restoredFrom: bestSnap.blockHeight,
                commonAncestor: ancestor,
                lastLocal: last.height
            };
        } else {
            console.warn(
                `Reorg detected but no snapshot available <= ancestor=${ancestor}. ` +
                `Caller must trigger full re-parse from genesis.`
            );
            return {
                restoredFrom: 0,
                commonAncestor: ancestor,
                lastLocal: last.height
            };
        }
    }
}

module.exports = Persistence;
