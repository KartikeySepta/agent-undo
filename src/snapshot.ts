import fs from 'fs';
import path from 'path';

/**
 * Creates an instantaneous APFS/Btrfs CoW snapshot of a directory.
 * Falls back to a standard recursive copy if the OS/filesystem doesn't support it.
 */
export function takeSnapshot(sourceDir: string, snapshotDir: string): void {
    if (fs.existsSync(snapshotDir)) {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
    }
    
    console.log(`[Agent-Undo] Taking instantaneous snapshot of ${sourceDir}...`);
    const startTime = Date.now();
    
    // Using the secret researched flag for instantaneous clonefile
    fs.cpSync(sourceDir, snapshotDir, {
        recursive: true,
        mode: fs.constants.COPYFILE_FICLONE,
        filter: (src) => {
            // Ignore the snapshot directory itself if it's inside the source
            if (src === snapshotDir) return false;
            // Ignore standard git files to keep it clean (optional, but good practice)
            if (src.includes('.git/')) return false;
            return true;
        }
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Agent-Undo] Snapshot created successfully in ${elapsed}ms at ${snapshotDir}`);
}

/**
 * Reverts the source directory exactly to the state of the snapshot.
 */
export function revertSnapshot(sourceDir: string, snapshotDir: string): void {
    if (!fs.existsSync(snapshotDir)) {
        throw new Error(`[Agent-Undo] No snapshot found at ${snapshotDir}. Cannot revert.`);
    }

    console.log(`[Agent-Undo] Reverting environment back to snapshot...`);
    const startTime = Date.now();

    // 1. Wipe the current directory (except .git to prevent repository corruption)
    const items = fs.readdirSync(sourceDir);
    for (const item of items) {
        if (item === '.git' || path.join(sourceDir, item) === snapshotDir) continue;
        fs.rmSync(path.join(sourceDir, item), { recursive: true, force: true });
    }

    // 2. Instantly copy everything back from the snapshot
    fs.cpSync(snapshotDir, sourceDir, {
        recursive: true,
        mode: fs.constants.COPYFILE_FICLONE
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Agent-Undo] Environment perfectly restored in ${elapsed}ms!`);
}
