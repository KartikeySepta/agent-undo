#!/usr/bin/env node
import { program } from 'commander';
import {
  takeSnapshot, revertSnapshot, listSnapshots, diffSnapshot, pruneSnapshots,
} from './snapshot';

const cwd = process.cwd();
const fail = (e: unknown): never => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
};

program.name('agent-undo').description('The Time Machine for AI Coding Agents').version('1.1.0');

program
  .command('snapshot [name]')
  .description('Take an instant snapshot of the current directory (optionally named)')
  .action((name?: string) => {
    try {
      const m = takeSnapshot(cwd, { name });
      console.log(`✅ Snapshot ${m.id} (${m.mode === 'cow' ? 'copy-on-write' : 'full copy, no CoW on this filesystem'}, ${m.elapsedMs}ms)`);
    } catch (e) { fail(e); }
  });

program
  .command('list')
  .description('List snapshots for this directory')
  .action(() => {
    const all = listSnapshots(cwd);
    if (!all.length) return console.log('No snapshots.');
    for (const s of all) console.log(`${s.id}  [${s.mode}]${s.reason ? '  ' + s.reason : ''}`);
  });

program
  .command('diff [snapshot]')
  .description('Show what changed since a snapshot (default: latest) — i.e. what revert would undo')
  .action((ref?: string) => {
    try {
      const d = diffSnapshot(cwd, ref);
      d.added.forEach((f) => console.log(`+ ${f}`));
      d.modified.forEach((f) => console.log(`~ ${f}`));
      d.deleted.forEach((f) => console.log(`- ${f}`));
      console.log(`\n${d.added.length} added, ${d.modified.length} modified, ${d.deleted.length} deleted`);
    } catch (e) { fail(e); }
  });

program
  .command('revert [snapshot]')
  .description('Restore a snapshot (default: latest). Takes a "pre-revert" backup first.')
  .option('-y, --yes', 'skip the confirmation preview')
  .action((ref: string | undefined, o: { yes?: boolean }) => {
    try {
      if (!o.yes) {
        const d = diffSnapshot(cwd, ref);
        const n = d.added.length + d.modified.length + d.deleted.length;
        console.log(`Revert would undo ${n} change(s): ${d.added.length} added, ${d.modified.length} modified, ${d.deleted.length} deleted.`);
        console.log('Re-run with --yes to proceed (use `agent-undo diff` to see files).');
        return;
      }
      const { restored, backup } = revertSnapshot(cwd, ref);
      console.log(`✅ Restored ${restored.id}. Undo this revert with: agent-undo revert ${backup.id} --yes`);
    } catch (e) { fail(e); }
  });

program
  .command('prune')
  .description('Delete old unnamed snapshots, keeping the newest N')
  .option('-k, --keep <n>', 'how many to keep', '10')
  .action((o: { keep: string }) => console.log(`Pruned ${pruneSnapshots(cwd, Number(o.keep))} snapshot(s).`));

program.parse();
