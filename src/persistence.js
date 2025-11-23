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
            throw new Error("Persistence requires { network, test }");
        }

        //
        // ───────────────────────────────────────────
        // NETWORK IDENTIFICATION  (OPTION 1)
        // ───────────────────────────────────────────
        //
        const raw = options.network.toLowerCase().trim();   // "ltc" | "btc"
        const testFlag = !!options.test;                    // true | false

        this.network = raw;                                 // "ltc"
        this.isTest = testFlag;
        this.networkFull = `${raw}-${testFlag ? "test" : "main"}`;
        console.log("[Persistence] Using network:", this.networkFull);

        //
        // ───────────────────────────────────────────
        // DIRECTORY LAYOUT
        // ───────────────────────────────────────────
        //
        const baseDir = path.join(__dirname, "..", "nedb-data");

        this.dbDir        = path.join(baseDir, this.networkFull);
        this.snapshotsDir = path.join(baseDir, `${this.networkFull}-snapshots`);
        this.backupsDir   = path.join(baseDir, `${this.networkFull}-backups`);

        this.snapshotInterval = options.snapshotInterval || 1000;
        this.client = null; // filled in init()

        Persistence.instance = this;
    }

    //
    // ───────────────────────────────────────────
    // INIT — MUST BE CALLED BY MAIN ONCE
    // ───────────────────────────────────────────
    //
    async init() {
        const fsP = fs.promises;

        await fsP.mkdir(this.dbDir, { recursive: true });
        await fsP.mkdir(this.snapshotsDir, { recursive: true });
        await fsP.mkdir(this.backupsDir, { recursive: true });

        this.client = await ClientWrapper.getInstance(true);

        console.log("[Persistence] Initialized for", this.networkFull);
    }

    //
    // ───────────────────────────────────────────
    // BLOCK HEADER TRACKING
    // ───────────────────────────────────────────
    //
    async recordBlockHeader(blockHeight, blockHash, prevBlockHash) {
        const base = await db.getDatabase("persistence");
        await base.updateAsync(
            { _id: `block-${blockHeight}` },
            {
                $set: {
                    height: blockHeight,
                    hash: blockHash,
                    prevHash: prevBlockHash,
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
        if (!docs || docs.length === 0) return null;
        docs.sort((a, b) => a.height - b.height);
        return docs.at(-1);
    }

    //
    // ───────────────────────────────────────────
    // SNAPSHOT CREATION (EBUSY-SAFE)
    // ───────────────────────────────────────────
    //
    async createSnapshot(blockHeight, consensusHash) {
        const fsP = fs.promises;

        const short = (consensusHash || "nohash").slice(0, 12);
        const dirName = `${blockHeight}-${short}`;
        const snapshotPath = path.join(this.snapshotsDir, dirName);

        await fsP.mkdir(snapshotPath, { recursive: true });

        const files = await fsP.readdir(this.dbDir);
        const copied = [];

        for (const file of files) {
            if (!file.endsWith(".db")) continue;

            const src = path.join(this.dbDir, file);
            const dst = path.join(snapshotPath, file);

            try {
                // Windows-safe temp-step
                const tmp = dst + ".tmp";
                await fsP.copyFile(src, tmp);
                await fsP.rename(tmp, dst);

                copied.push(file);
            } catch (err) {
                console.error("[Snapshot] ERROR copying", file, err);
            }
        }

        const meta = {
            blockHeight,
            consensusHash,
            createdAt: new Date().toISOString(),
            files: copied,
        };

        await fsP.writeFile(
            path.join(snapshotPath, "meta.json"),
            JSON.stringify(meta, null, 2)
        );

        await this.pruneOldSnapshots(2);

        console.log(`Snapshot created at ${blockHeight} (${dirName})`);
    }

    //
    // ───────────────────────────────────────────
    // PRUNE OLD SNAPSHOTS
    // ───────────────────────────────────────────
    //
    async pruneOldSnapshots(keep = 2) {
        const fsP = fs.promises;

        let entries;
        try {
            entries = await fsP.readdir(this.snapshotsDir, {
                withFileTypes: true,
            });
        } catch {
            return;
        }

        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        if (dirs.length <= keep) return;

        dirs.sort((a, b) => {
            const A = parseInt(a.split("-")[0]);
            const B = parseInt(b.split("-")[0]);
            return A - B;
        });

        const deleteThese = dirs.slice(0, dirs.length - keep);

        for (const d of deleteThese) {
            const full = path.join(this.snapshotsDir, d);
            console.log("Pruning old snapshot:", d);
            await fsP.rm(full, { recursive: true, force: true });
        }
    }

    //
    // ───────────────────────────────────────────
    // RESTORE SNAPSHOT (EBUSY-SAFE)
    // ───────────────────────────────────────────
    //
    async restoreSnapshot(snapshotMeta) {
        const fsP = fs.promises;

        const snapshotDir = path.join(this.snapshotsDir, snapshotMeta.dir);
        const files = snapshotMeta.files || (await fsP.readdir(snapshotDir));

        //
        // 1. Make a fresh backup
        //
        const backupDir = path.join(
            this.backupsDir,
            `backup-${Date.now()}`
        );
        await fsP.mkdir(backupDir, { recursive: true });

        const currentFiles = await fsP.readdir(this.dbDir);

        for (const f of currentFiles) {
            if (!f.endsWith(".db")) continue;
            const src = path.join(this.dbDir, f);
            const dst = path.join(backupDir, f);
            try {
                await fsP.copyFile(src, dst);
            } catch (e) {
                console.warn("[Restore] Backup copy failed:", f, e);
            }
        }

        //
        // 2. Overwrite live DB using temp file strategy
        //
        for (const f of currentFiles) {
            if (!f.endsWith(".db")) continue;
            try {
                await fsP.rm(path.join(this.dbDir, f), {
                    force: true,
                });
            } catch (e) {
                console.warn("[Restore] Remove old failed:", f, e);
            }
        }

        for (const f of files) {
            if (!f.endsWith(".db")) continue;

            const src = path.join(snapshotDir, f);
            const dst = path.join(this.dbDir, f);

            try {
                const tmp = dst + ".tmp";
                await fsP.copyFile(src, tmp);
                await fsP.rename(tmp, dst);
            } catch (e) {
                console.error("[Restore] Copy snapshot failed:", f, e);
            }
        }

        console.log(
            `Restored DB from snapshot ${snapshotMeta.dir} (block=${snapshotMeta.blockHeight})`
        );
    }

    //
    // ───────────────────────────────────────────
    // LIST SNAPSHOTS
    // ───────────────────────────────────────────
    //
    async listSnapshots() {
        const fsP = fs.promises;

        let entries;
        try {
            entries = await fsP.readdir(this.snapshotsDir, {
                withFileTypes: true,
            });
        } catch {
            return [];
        }

        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const snapshots = [];

        for (const dir of dirs) {
            const metaPath = path.join(this.snapshotsDir, dir, "meta.json");
            try {
                const raw = await fsP.readFile(metaPath, "utf8");
                const meta = JSON.parse(raw);
                meta.dir = dir;
                snapshots.push(meta);
            } catch {
                console.warn("[Snapshots] Invalid meta.json in", dir);
            }
        }

        snapshots.sort((a, b) => a.blockHeight - b.blockHeight);
        return snapshots;
    }

    //
    // ───────────────────────────────────────────
    // USED BY getSnapshotForHeight()
    // ───────────────────────────────────────────
    //
    async getSnapshotForHeight(h) {
        const snaps = await this.listSnapshots();
        if (!snaps.length) return null;

        // choose snapshot with largest blockHeight <= h
        let best = null;
        for (const s of snaps) {
            if (s.blockHeight <= h) {
                if (!best || s.blockHeight > best.blockHeight) best = s;
            }
        }
        return best;
    }

    //
    // ───────────────────────────────────────────
    // REORG DETECTION (TOP CHECK DISABLED)
    // ───────────────────────────────────────────
    //
    async detectAndHandleReorg(currentHeight) {
        const last = await this.getLastKnownBlock();
        if (!last) return null;

        let nodeHash;
        try {
            nodeHash = await this.client.getBlockHash(last.height);
        } catch (e) {
            console.warn("[Reorg] Could not fetch node hash:", e);
            return null;
        }

        // COMMENTED OUT ON PURPOSE FOR YOUR DRILLING
        // if (nodeHash === last.hash) return null;

        console.warn(
            `Reorg suspected: local(${last.height})=${last.hash}, node=${nodeHash}`
        );

        // Always use the passed height
        const bestSnap = await this.getSnapshotForHeight(currentHeight);
        if (!bestSnap) {
            console.warn("[Reorg] No snapshot <= height; full rebuild required.");
            return { restoredFrom: 0, commonAncestor: currentHeight, lastLocal: last.height };
        }

        await this.restoreSnapshot(bestSnap);

        return {
            restoredFrom: bestSnap.blockHeight,
            commonAncestor: currentHeight,
            lastLocal: last.height,
        };
    }
}

module.exports = Persistence;
