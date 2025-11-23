// persistence.js
const fs = require("fs");
const path = require("path");
const db = require("./db.js");
const ConsensusDatabase = require("./consensus.js");
const ClientWrapper = require("./client.js");

class Persistence {
    static instance = null;

    constructor(options = {}) {
        if (Persistence.instance) return Persistence.instance;

        if (!options.network) {
            throw new Error("Persistence requires { network: 'ltc-test' | 'ltc-main' | 'btc-main' }");
        }

        this.network = options.network.toLowerCase().trim();
        this.network += options.test ? '-test' : '-main'

        //
        // ───────────────────────────────────────────────────────────────────────────────
        // DIRECTORY LAYOUT (WINDOWS-SAFE)
        // ───────────────────────────────────────────────────────────────────────────────
        // nedb-data/
        //     ltc-test/              ← LIVE DB (ONLY .db FILES)
        //     ltc-test-snapshots/    ← SNAPSHOTS
        //     ltc-test-backups/      ← BACKUPS OF LIVE DB
        //
        // NOTHING except *.db lives inside ltc-test/.
        //
        // ───────────────────────────────────────────────────────────────────────────────
        //

        const baseDir = path.join(__dirname, "..", "nedb-data");

        this.dbDir        = path.join(baseDir, this.network);
        this.snapshotsDir = path.join(baseDir, `${this.network}-snapshots`);
        this.backupsDir   = path.join(baseDir, `${this.network}-backups`);

        this.snapshotInterval = options.snapshotInterval || 1000;

        this.client = null;

        Persistence.instance = this;
    }

    // Singleton init
    static async getInstance(options = {}) {
        if (!Persistence.instance) {
            Persistence.instance = new Persistence(options);
            await Persistence.instance.init();
        }
        return Persistence.instance;
    }

    async init() {
        // Ensure directories exist
        await fs.promises.mkdir(this.dbDir, { recursive: true });
        await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
        await fs.promises.mkdir(this.backupsDir, { recursive: true });

        // Attach RPC client
        this.client = await ClientWrapper.getInstance(true);
    }

    // ───────────────────────────────────────────────────────────────
    // BLOCK HEADER TRACKING
    // ───────────────────────────────────────────────────────────────

    async recordBlockHeader(blockHeight, blockHash, prevHash) {
        const base = await db.getDatabase("persistence");
        await base.updateAsync(
            { _id: `block-${blockHeight}` },
            {
                $set: {
                    height: blockHeight,
                    hash: blockHash,
                    prevHash,
                    createdAt: Date.now(),
                },
            },
            { upsert: true }
        );
    }

    async getBlockHeader(blockHeight) {
        const base = await db.getDatabase("persistence");
        return base.findOneAsync({ _id: `block-${blockHeight}` });
    }

    async getLastKnownBlock() {
        const base = await db.getDatabase("persistence");
        const docs = await base.findAsync({ height: { $exists: true } });
        if (!docs.length) return null;

        docs.sort((a, b) => a.height - b.height);
        return docs[docs.length - 1];
    }

    async checkForReorgForNewBlock(blockHeight, prevBlockHash) {
        if (blockHeight === 0) return false;

        const last = await this.getBlockHeader(blockHeight - 1);
        if (!last) return false;

        if (last.hash !== prevBlockHash) {
            console.warn(
                `Reorg detected at height ${blockHeight}: stored=${last.hash}, incomingPrev=${prevBlockHash}`
            );
            return true;
        }
        return false;
    }

    // ───────────────────────────────────────────────────────────────
    // SNAPSHOTS
    // ───────────────────────────────────────────────────────────────

    async maybeCheckpoint(blockHeight) {
        if (!this.snapshotInterval) return;
        if (blockHeight % this.snapshotInterval !== 0) return;

        const hash = await ConsensusDatabase.stateConsensusHash();
        await ConsensusDatabase.storeConsensusHash(blockHeight, hash);

        await this.createSnapshot(blockHeight, hash);
    }

    async createSnapshot(blockHeight, consensusHash) {
        const fsP = fs.promises;
        const short = (consensusHash || "nohash").slice(0, 12);
        const dirName = `${blockHeight}-${short}`;

        const snapshotPath = path.join(this.snapshotsDir, dirName);
        await fsP.mkdir(snapshotPath, { recursive: true });

        const files = await fsP.readdir(this.dbDir);
        const copied = [];

        for (const file of files) {
            if (!file.endsWith(".db")) continue;   // ONLY DB FILES
            const src = path.join(this.dbDir, file);
            const dst = path.join(snapshotPath, file);
            await fsP.copyFile(src, dst);
            copied.push(file);
        }

        await fsP.writeFile(
            path.join(snapshotPath, "meta.json"),
            JSON.stringify(
                {
                    blockHeight,
                    consensusHash,
                    createdAt: new Date().toISOString(),
                    files: copied,
                },
                null,
                2
            )
        );

        await this.pruneOldSnapshots(2);
        console.log(`Snapshot created at ${blockHeight} (${dirName})`);
    }

    async listSnapshots() {
        const fsP = fs.promises;
        let list = [];

        try {
            const entries = await fsP.readdir(this.snapshotsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const metaPath = path.join(this.snapshotsDir, entry.name, "meta.json");
                try {
                    const raw = await fsP.readFile(metaPath, "utf8");
                    const json = JSON.parse(raw);
                    json.dir = entry.name;
                    list.push(json);
                } catch (_) {}
            }
        } catch (e) {
            return [];
        }

        list.sort((a, b) => a.blockHeight - b.blockHeight);
        return list;
    }

    async pruneOldSnapshots(keep = 2) {
        const snaps = await this.listSnapshots();
        if (snaps.length <= keep) return;

        const remove = snaps.slice(0, snaps.length - keep);
        for (const snap of remove) {
            const dirPath = path.join(this.snapshotsDir, snap.dir);
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            console.log(`Pruned old snapshot: ${snap.dir}`);
        }
    }

    /**
     * Pick the snapshot *closest below* the ancestor height,
     * but ignore any snapshot that is above the latest “expected interval”
     * to prevent pollution from stale leftover snapshot dirs.
     *
     * This guarantees:
     *   - no old snapshot from past runs is selected
     *   - only snapshots from the current interval window are valid
     */
    async findBestSnapshotBefore(height) {
        const snaps = await this.listSnapshots();
        if (!snaps.length) return null;

        const interval = this.snapshotInterval || 1000;

        // Valid window: [height - interval, height]
        const lowerBound = Math.max(0, height - interval);

        let best = null;

        for (const s of snaps) {
            // Snapshot must be in valid window AND <= ancestor
            if (s.blockHeight <= height && s.blockHeight >= lowerBound) {
                if (!best || s.blockHeight > best.blockHeight) {
                    best = s;
                }
            }
        }

        return best;
    }


    // ───────────────────────────────────────────────────────────────
    // RESTORE LOGIC (WINDOWS SAFE)
    // ───────────────────────────────────────────────────────────────

    async restoreSnapshot(snapshotMeta) {
        const fsP = fs.promises;

        const snapPath = path.join(this.snapshotsDir, snapshotMeta.dir);

        // Create fresh backup of current DB (.db files only)
        const backupDir = path.join(this.backupsDir, `backup-${Date.now()}`);
        await fsP.mkdir(backupDir, { recursive: true });

        const currentFiles = await fsP.readdir(this.dbDir);

        for (const file of currentFiles) {
            if (!file.endsWith(".db")) continue;
            const src = path.join(this.dbDir, file);
            const dst = path.join(backupDir, file);
            await fsP.copyFile(src, dst);
        }

        // Remove ONLY .db files from live DB
        for (const file of currentFiles) {
            if (!file.endsWith(".db")) continue;
            await fsP.rm(path.join(this.dbDir, file), { force: true });
        }

        // Copy snapshot DB back into live DB
        for (const file of snapshotMeta.files) {
            const src = path.join(snapPath, file);
            const dst = path.join(this.dbDir, file);
            await fsP.copyFile(src, dst);
        }

        console.log(
            `Restored DB from snapshot ${snapshotMeta.dir} (block=${snapshotMeta.blockHeight})`
        );
    }

    // ───────────────────────────────────────────────────────────────
    // FULL REORG RECOVERY (OFFLINE + DEEP)
    // ───────────────────────────────────────────────────────────────

    async detectAndHandleReorg(block) {
        const last = await this.getLastKnownBlock();
        if (!last) return null;

        const nodeHash = await this.client.getBlockHash(last.height);

        //if (nodeHash === last.hash) return null;

        console.warn(
            `Reorg suspected: local(${last.height})=${last.hash}, node=${nodeHash}`
        );

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

        const snap = await this.findBestSnapshotBefore(block);
        if (snap) {
            await this.restoreSnapshot(snap);

            return {
                restoredFrom: snap.blockHeight,
                commonAncestor: ancestor,
                lastLocal: last.height,
            };
        }

        console.warn(`No snapshot ≤ ancestor ${ancestor}. Full reparse required.`);
        return {
            restoredFrom: 0,
            commonAncestor: ancestor,
            lastLocal: last.height,
        };
    }
}

module.exports = Persistence;
