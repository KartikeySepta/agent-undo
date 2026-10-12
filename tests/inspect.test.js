const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const cli = (s, ...args) => execFileSync(process.execPath, [BIN('agent-undo.cjs'), ...args], { cwd: s.project, env: s.env, encoding: 'utf8' });
const fails = (s, ...args) => {
  try { cli(s, ...args); } catch (e) { return e.stderr.toString(); }
  throw new Error(`expected "${args.join(' ')}" to fail`);
};

test('show prints a file as it was in the snapshot and rejects escapes', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('src/a.txt', 'one\n');
  cli(s, 'snapshot', 'base');
  s.write('src/a.txt', 'two\n'); s.write('new.txt', 'x');
  assert.strictEqual(cli(s, 'show', 'src/a.txt'), 'one\n');
  assert.strictEqual(cli(s, 'show', 'src/a.txt', 'base'), 'one\n');
  assert.match(fails(s, 'show', 'new.txt'), /not in snapshot/);
  assert.match(fails(s, 'show', '../outside'), /not a path inside the project/);
  assert.match(fails(s, 'show', 'src/a.txt', 'nope'), /No snapshot matches/);
});

test('diff --file is a unified diff; added and deleted files diff against nothing', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one\n'); s.write('gone.txt', 'bye\n');
  cli(s, 'snapshot');
  s.write('a.txt', 'one\nthree\n'); s.write('b.txt', 'new\n'); fs.rmSync(s.p('gone.txt'));
  assert.match(cli(s, 'diff', '--file', 'a.txt'), /^--- a\.txt \(.*\)\n\+\+\+ a\.txt \(now\)\n[\s\S]*\+three/);
  assert.match(cli(s, 'diff', '--file', 'b.txt'), /@@ -0,0 \+1 @@\n\+new/);
  assert.match(cli(s, 'diff', '--file', 'gone.txt'), /-bye/);
  assert.match(fails(s, 'diff', '--file', 'zzz'), /neither in snapshot .* nor in the project/);
  s.write('a.txt', 'one\n');
  assert.match(cli(s, 'diff', '--file', 'a.txt'), /unchanged since/);
});

test('list --json and diff --json are machine-readable', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  cli(s, 'snapshot', 'base');
  s.write('a.txt', 'two'); s.write('b.txt', 'x');
  const list = JSON.parse(cli(s, 'list', '--json'));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'base');
  assert.strictEqual(list[0].trigger, 'manual');
  assert.deepStrictEqual(JSON.parse(cli(s, 'diff', '--json')), { added: ['b.txt'], modified: ['a.txt'], deleted: [] });
  assert.match(cli(s, 'list'), /-base\s+\[manual, \w+\]\s+just now/);
});

test('delete removes one snapshot by name and refuses an implicit latest', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  cli(s, 'snapshot', 'keep'); cli(s, 'snapshot', 'drop');
  assert.match(fails(s, 'delete', 'latest'), /Name the snapshot/);
  assert.match(cli(s, 'delete', 'drop'), /Deleted .*-drop/);
  const ids = core.listSnapshots(s.project).map((m) => m.name);
  assert.deepStrictEqual(ids, ['keep']);
  assert.match(fails(s, 'delete', 'drop'), /No snapshot matches/);
});

test('prune --older-than keeps named snapshots and the session baseline', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  core.takeSnapshot(s.project, { trigger: 'session' });
  core.takeSnapshot(s.project, { name: 'named' });
  const old1 = core.takeSnapshot(s.project); const old2 = core.takeSnapshot(s.project);
  // Age the unnamed ones by rewriting their metadata.
  for (const m of [old1, old2]) {
    const file = path.join(core.snapshotBase(s.project), m.id, 'meta.json');
    fs.writeFileSync(file, JSON.stringify({ ...m, createdAt: new Date(Date.now() - 3 * 86400e3).toISOString() }));
  }
  assert.match(cli(s, 'prune', '--older-than', '7d'), /Pruned 0/);
  assert.match(cli(s, 'prune', '--older-than', '1d'), /Pruned 2/);
  assert.deepStrictEqual(core.listSnapshots(s.project).map((m) => m.trigger ?? m.name), ['session', 'manual']);
  assert.match(fails(s, 'prune', '--older-than', 'soon'), /Bad age/);
});

test('snapshot --if-changed skips when the tree is unchanged', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  assert.match(cli(s, 'snapshot', '--if-changed'), /✅ Snapshot/, 'first snapshot always taken');
  assert.match(cli(s, 'snapshot', '--if-changed'), /Nothing changed/);
  s.write('a.txt', 'two');
  assert.match(cli(s, 'snapshot', '--if-changed'), /✅ Snapshot/);
  assert.strictEqual(core.listSnapshots(s.project).length, 2);
});

test('core: snapshotFilePath, deleteSnapshot and pruneOlderThan are exported', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const m = core.takeSnapshot(s.project, { name: 'x' });
  assert.strictEqual(fs.readFileSync(core.snapshotFilePath(s.project, 'a.txt').path, 'utf8'), 'one');
  assert.strictEqual(core.snapshotFilePath(s.project, 'missing.txt').path, null);
  assert.throws(() => core.snapshotFilePath(s.project, '/etc/passwd'), /not a path inside the project/);
  assert.throws(() => core.pruneOlderThan(s.project, -1), /non-negative/);
  assert.strictEqual(core.deleteSnapshot(s.project, 'x').id, m.id);
  assert.strictEqual(core.listSnapshots(s.project).length, 0);
});
