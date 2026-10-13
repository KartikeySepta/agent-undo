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

test('snapshotDir and `path` point at the snapshot\'s own copy of the project', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const m = core.takeSnapshot(s.project, { name: 'base' });
  const dir = core.snapshotDir(s.project, 'base');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one');
  assert.strictEqual(cli(s, 'path').trim(), dir);
  assert.strictEqual(cli(s, 'path', m.id).trim(), dir);
  assert.match(fails(s, 'path', 'nope'), /No snapshot matches/);
});

test('diffSnapshots compares two snapshots, or a snapshot against now', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one'); s.write('gone.txt', 'x');
  core.takeSnapshot(s.project, { name: 'first' });
  s.write('a.txt', 'two'); s.write('b.txt', 'new'); fs.rmSync(s.p('gone.txt'));
  core.takeSnapshot(s.project, { name: 'second' });
  s.write('c.txt', 'later');
  assert.deepStrictEqual(core.diffSnapshots(s.project, 'first', 'second'), { added: ['b.txt'], modified: ['a.txt'], deleted: ['gone.txt'] });
  assert.deepStrictEqual(core.diffSnapshots(s.project, 'second'), { added: ['c.txt'], modified: [], deleted: [] });
  assert.deepStrictEqual(core.diffSnapshots(s.project, 'first', 'first'), { added: [], modified: [], deleted: [] });
});

test('fork gives a working copy whose changes never touch the project', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const { meta, dir } = core.fork(s.project, 'try: echo hi');
  assert.strictEqual(meta.trigger, 'fork');
  assert.strictEqual(meta.reason, 'try: echo hi');
  assert.strictEqual(dir, core.snapshotDir(s.project, meta.id));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed in fork');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.ok(!s.exists('new.txt'));
  // The fork shows up as an ordinary snapshot, so list/path/delete all work on it.
  assert.strictEqual(core.listSnapshots(s.project).at(-1).id, meta.id);
});
