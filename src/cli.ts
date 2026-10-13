#!/usr/bin/env node
import { program } from 'commander';
import {
  takeSnapshot, revertSnapshot, listSnapshots, diffSnapshot, pruneSnapshots, repairInterruptedRevert, snapshotFilePath, deleteSnapshot, pruneOlderThan, snapshotDir, readCheckConfig, writeCheckConfig, SnapshotMeta,
} from './snapshot';
import { VERSION } from './version';
import { LEVELS, isLevel, readLevel, writeLevel } from './config';
import { doctor, status, protectedBytes } from './status';
import { tryInFork, describeTry } from './try';
import { runCheck } from './check';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const cwd = process.cwd();
const MODE_LABEL = { clonefile: 'clonefile', cow: 'copy-on-write', copy: 'full copy: no CoW on this filesystem', moved: 'moved' } as const;
const fail = (e: unknown): never => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
};

program.name('agent-undo').description('The Time Machine for AI Coding Agents').version(VERSION);

const mark = (s: SnapshotMeta) => (s.check ? (s.check.ok ? '  ✓ green' : '  ✗ red') : '');

/** "just now", "3m ago", "2h ago", "5d ago". */
function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

program
  .command('snapshot [name]')
  .description('Take an instant snapshot of the current directory (optionally named)')
  .option('--if-changed', 'skip when nothing changed since the latest snapshot')
  .action((name: string | undefined, o: { ifChanged?: boolean }) => {
    try {
      if (o.ifChanged && listSnapshots(cwd).length) {
        const d = diffSnapshot(cwd);
        if (!d.added.length && !d.modified.length && !d.deleted.length) {
          return console.log(`Nothing changed since ${listSnapshots(cwd).at(-1)!.id}; no snapshot taken.`);
        }
      }
      const m = takeSnapshot(cwd, { name });
      console.log(`✅ Snapshot ${m.id} (${MODE_LABEL[m.mode]}, ${m.elapsedMs}ms)`);
    } catch (e) { fail(e); }
  });

program
  .command('list')
  .description('List snapshots for this directory')
  .option('--json', 'machine-readable output')
  .action((o: { json?: boolean }) => {
    const all = listSnapshots(cwd);
    if (o.json) return console.log(JSON.stringify(all, null, 2));
    if (!all.length) return console.log('No snapshots.');
    for (const s of all) console.log(`${s.id}  [${s.trigger ?? 'manual'}, ${s.mode}]${mark(s)}  ${ago(s.createdAt)}${s.reason ? '  ' + s.reason : ''}`);
  });

/** Unified diff of one file between the snapshot and the working tree, via the system `diff`. */
function fileDiff(file: string, ref?: string): void {
  const { snapshot, path: before } = snapshotFilePath(cwd, file, ref);
  const live = path.join(cwd, file);
  const now = fs.existsSync(live) && fs.statSync(live).isFile() ? live : null;
  if (!before && !now) fail(new Error(`"${file}" is neither in snapshot ${snapshot.id} nor in the project.`));
  const r = spawnSync('diff', ['-u', '--label', `${file} (${snapshot.id})`, '--label', `${file} (now)`, before ?? '/dev/null', now ?? '/dev/null'], { encoding: 'utf8' });
  if (r.error) fail(new Error(`could not run \`diff\`: ${r.error.message}. Use \`agent-undo show ${file}\` to print the snapshot copy.`));
  if (r.status === 0) return console.log(`${file}: unchanged since ${snapshot.id}`);
  if (r.status !== 1) fail(new Error(r.stderr.trim() || `diff exited with ${r.status}`));
  process.stdout.write(r.stdout);
}

program
  .command('diff [snapshot]')
  .description('Show what changed since a snapshot (default: latest) — i.e. what revert would undo')
  .option('-f, --file <path>', 'unified diff of one file between the snapshot and now')
  .option('--json', 'machine-readable output')
  .action((ref: string | undefined, o: { file?: string; json?: boolean }) => {
    try {
      if (o.file) return fileDiff(o.file, ref);
      const d = diffSnapshot(cwd, ref);
      if (o.json) return console.log(JSON.stringify(d, null, 2));
      d.added.forEach((f) => console.log(`+ ${f}`));
      d.modified.forEach((f) => console.log(`~ ${f}`));
      d.deleted.forEach((f) => console.log(`- ${f}`));
      console.log(`\n${d.added.length} added, ${d.modified.length} modified, ${d.deleted.length} deleted`);
    } catch (e) { fail(e); }
  });

program
  .command('show <path> [snapshot]')
  .description('Print a file as it was in a snapshot (default: latest), without reverting anything')
  .action((file: string, ref?: string) => {
    try {
      const { snapshot, path: p } = snapshotFilePath(cwd, file, ref);
      if (!p) fail(new Error(`"${file}" is not in snapshot ${snapshot.id}.`));
      process.stdout.write(fs.readFileSync(p!));
    } catch (e) { fail(e); }
  });

program
  .command('try <command>')
  .description('Run a command in a copy-on-write fork of the project; swap the result in only if it (and --check) succeed')
  .option('-c, --check <cmd>', 'must pass inside the fork before the result is applied, e.g. "npm test"')
  .option('-t, --timeout <seconds>', 'kill the command or the check after this long')
  .action((command: string, o: { check?: string; timeout?: string }) => {
    try {
      const r = tryInFork(cwd, command, { check: o.check, timeoutMs: o.timeout ? Number(o.timeout) * 1000 : undefined });
      if (!r.ok) fail(new Error(describeTry(r)));
      console.log(`✅ ${describeTry(r)}`);
    } catch (e) { fail(e); }
  });

program
  .command('check [command]')
  .description('Run the project\'s check (e.g. the tests) and mark the matching snapshot green or red; "last-green" then names the newest green one')
  .option('--set <cmd>', 'save this as the project\'s check command instead of running one')
  .option('--auto', 'with --set: at paranoid level, run the check at the end of every agent turn')
  .action((command: string | undefined, o: { set?: string; auto?: boolean }) => {
    try {
      if (o.set) {
        writeCheckConfig(cwd, { command: o.set, auto: !!o.auto });
        return console.log(`Saved check "${o.set}" (auto: ${o.auto ? 'on' : 'off'}). Run it with: agent-undo check`);
      }
      const r = runCheck(cwd, command);
      if (!r.ok) fail(new Error(`Check "${r.command}" failed (${r.run.timedOut ? 'timed out' : 'exit ' + (r.run.status ?? r.run.signal)}).${r.snapshot ? ` ${r.snapshot.id} is red.` : ''}`));
      console.log(`✅ Check passed: ${r.snapshot!.id} is green. Back to it any time with: agent-undo revert last-green --yes`);
    } catch (e) { fail(e); }
  });

program
  .command('path [snapshot]')
  .description('Print the directory holding a snapshot\'s copy of the project (default: latest), to cd into the past')
  .action((ref?: string) => {
    try { console.log(snapshotDir(cwd, ref)); } catch (e) { fail(e); }
  });

program
  .command('revert [snapshot]')
  .description('Restore a snapshot (default: latest). Takes a "pre-revert" backup first.')
  .option('-y, --yes', 'skip the confirmation preview')
  .option('-o, --only <paths...>', 'restore only these paths, leave everything else alone')
  .action((ref: string | undefined, o: { yes?: boolean; only?: string[] }) => {
    try {
      if (!o.yes && !o.only) {
        const d = diffSnapshot(cwd, ref);
        const n = d.added.length + d.modified.length + d.deleted.length;
        console.log(`Revert would undo ${n} change(s): ${d.added.length} added, ${d.modified.length} modified, ${d.deleted.length} deleted.`);
        console.log('Re-run with --yes to proceed (use `agent-undo diff` to see files).');
        return;
      }
      const { restored, backup } = revertSnapshot(cwd, ref, { only: o.only });
      console.log(`✅ Restored ${restored.id}. Undo this revert with: agent-undo revert ${backup.id} --yes`);
    } catch (e) { fail(e); }
  });

program
  .command('delete <snapshot>')
  .description('Delete one snapshot by id or name (named snapshots are otherwise never pruned)')
  .action((ref: string) => {
    try { console.log(`Deleted ${deleteSnapshot(cwd, ref).id}.`); } catch (e) { fail(e); }
  });

program
  .command('prune')
  .description('Delete old unnamed snapshots, keeping the newest N (or everything newer than --older-than)')
  .option('-k, --keep <n>', 'how many to keep', '10')
  .option('--older-than <age>', 'delete unnamed snapshots older than this, e.g. 90m, 12h, 7d')
  .action((o: { keep: string; olderThan?: string }) => {
    try {
      const n = o.olderThan ? pruneOlderThan(cwd, parseAge(o.olderThan)) : pruneSnapshots(cwd, Number(o.keep));
      console.log(`Pruned ${n} snapshot(s).`);
    } catch (e) { fail(e); }
  });

/** "90m", "12h", "7d" (also s, w) to milliseconds. */
function parseAge(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/.exec(text.trim());
  if (!m) throw new Error(`Bad age "${text}". Use a number plus s, m, h, d or w, e.g. 12h or 7d.`);
  const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2] as 's' | 'm' | 'h' | 'd' | 'w'];
  return Number(m[1]) * unit;
}

program
  .command('mode [level]')
  .description(`Show or set the level: ${LEVELS.join('|')}`)
  .action((level?: string) => {
    if (!level) return console.log(readLevel());
    if (!isLevel(level)) fail(new Error(`Unknown level "${level}". Use one of: ${LEVELS.join(', ')}`));
    writeLevel(level as (typeof LEVELS)[number]);
    console.log(`agent-undo level: ${level}`);
  });

program
  .command('stats')
  .description('Snapshots taken, reverts, and data protected (the /undo-gain scoreboard)')
  .option('--json', 'machine-readable output')
  .action((o: { json?: boolean }) => {
    const st = status(cwd);
    const bytes = protectedBytes(cwd);
    if (o.json) return console.log(JSON.stringify({ ...st, protectedBytes: bytes }, null, 2));
    const s = st.stats;
    const avg = s.snapshots ? Math.round(s.snapshotMsTotal / s.snapshots) : 0;
    const triggers = Object.entries(s.byTrigger).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    console.log(`⏪ agent-undo ${st.version}  level ${st.level}`);
    console.log(`snapshots taken   ${s.snapshots}  (${triggers}), avg ${avg}ms`);
    console.log(`reverts           ${s.reverts}  (${s.partialReverts} partial, ${s.pathsRestored} paths restored)`);
    console.log(`tries             ${s.tries}  (${s.triesApplied} applied, ${s.tries - s.triesApplied} kept the project unchanged)`);
    console.log(`this project      ${st.snapshots} snapshot(s), ${(bytes / 1e6).toFixed(1)} MB protected`);
    console.log(`since             ${s.since.slice(0, 10)}`);
  });

program
  .command('doctor')
  .description('Check the clone engine, store volume, and project setup')
  .option('--repair', 'finish or undo a revert that was interrupted (project empty or half restored)')
  .action((opts: { repair?: boolean }) => {
    if (opts.repair) {
      try {
        const done = repairInterruptedRevert(cwd);
        console.log(done ? `✅ ${done}` : 'Nothing to repair: no interrupted revert found.');
      } catch (e) { fail(e); }
    }
    const icon = { true: '✅', false: '❌', warn: '⚠️ ' } as const;
    const checks = doctor(cwd);
    for (const c of checks) console.log(`${icon[String(c.ok) as keyof typeof icon]} ${c.label.padEnd(13)} ${c.detail}`);
    if (checks.some((c) => c.ok === false)) process.exit(1);
  });

program.parse();
