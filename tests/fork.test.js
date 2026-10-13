const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

// ---------- try ----------

test('tryInFork applies the fork when the command and check pass, and the swap is undoable', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  core.takeSnapshot(s.project, { name: 'before' });
  const r = core.tryInFork(s.project, 'printf two > a.txt && printf made > made.txt', { check: 'test -f made.txt', stdio: 'pipe' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stage, 'applied');
  assert.strictEqual(s.read('a.txt'), 'two');
  assert.strictEqual(s.read('made.txt'), 'made');
  assert.deepStrictEqual(r.applied.changed, { added: ['made.txt'], modified: ['a.txt'], deleted: [] });
  assert.strictEqual(r.applied.backup.name, 'pre-revert');
  // Only the named snapshot and the undo handle remain: base and fork are cleaned up.
  assert.deepStrictEqual(core.listSnapshots(s.project).map((m) => m.name), ['before', 'pre-revert']);
  core.revertSnapshot(s.project, r.applied.backup.id);
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.ok(!s.exists('made.txt'));
});

test('tryInFork: a failing command leaves the project untouched and keeps the fork for inspection', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const r = core.tryInFork(s.project, 'printf bad > a.txt; echo oops >&2; exit 3', { stdio: 'pipe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'command');
  assert.strictEqual(r.command.status, 3);
  assert.match(r.command.stderr, /oops/);
  assert.strictEqual(s.read('a.txt'), 'one');
  const kept = core.listSnapshots(s.project);
  assert.strictEqual(kept.length, 1, 'base is discarded, fork is kept');
  assert.strictEqual(kept[0].trigger, 'fork');
  assert.strictEqual(fs.readFileSync(path.join(core.snapshotDir(s.project, kept[0].id), 'a.txt'), 'utf8'), 'bad');
});

test('tryInFork: a failing check leaves the project untouched', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const r = core.tryInFork(s.project, 'printf two > a.txt', { check: 'exit 1', stdio: 'pipe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'check');
  assert.strictEqual(r.check.status, 1);
  assert.strictEqual(s.read('a.txt'), 'one');
});

test('tryInFork refuses to apply when the project changed while the command ran', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  // The command runs in the fork; AGENT_UNDO_PROJECT names the real project, which someone edits meanwhile.
  const r = core.tryInFork(s.project, 'printf two > a.txt && printf drift > "$AGENT_UNDO_PROJECT/z.txt"', { stdio: 'pipe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'drift');
  assert.deepStrictEqual(r.drift, { added: ['z.txt'], modified: [], deleted: [] });
  assert.strictEqual(s.read('a.txt'), 'one', 'fork result not applied');
  assert.strictEqual(core.listSnapshots(s.project).at(-1).trigger, 'fork', 'fork kept so it can be applied by hand');
});

test('tryInFork rewrites the fork path to the project path in files the command wrote', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const r = core.tryInFork(s.project, 'printf "#!%s/bin/python\\n" "$PWD" > script; printf "\\0$PWD" > blob', { stdio: 'pipe' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.read('script'), `#!${s.project}/bin/python\n`);
  assert.strictEqual(r.applied.fixedPaths, 1, 'the binary file is left alone');
  assert.ok(fs.readFileSync(s.p('blob')).includes(Buffer.from(r.fork.id)), 'binary blob still names the fork');
});

test('tryInFork kills a command that exceeds the timeout', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const r = core.tryInFork(s.project, 'sleep 5', { timeoutMs: 300, stdio: 'pipe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'command');
  assert.strictEqual(r.command.timedOut, true);
});

test('cli: try applies on success and reports the undo handle; fails loudly otherwise', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const out = cli(s, 'try', 'printf two > a.txt', '--check', 'test -f a.txt');
  assert.match(out, /✅ Try passed.*1 change/);
  assert.match(out, /agent-undo revert .*pre-revert.* --yes/);
  assert.strictEqual(s.read('a.txt'), 'two');
  const err = fails(s, 'try', 'exit 2');
  assert.match(err, /❌ Command exited with 2[\s\S]*Project unchanged[\s\S]*agent-undo path /);
});

test('prune leaves a fork alone while a try could still be running in it', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const { meta } = core.fork(s.project, 'try: slow install');
  for (let i = 0; i < 12; i++) { s.write('a.txt', `v${i}`); core.takeSnapshot(s.project, { keep: 100 }); }
  core.pruneSnapshots(s.project, 2);
  assert.ok(core.listSnapshots(s.project).some((m) => m.id === meta.id), 'young fork kept');
  // An abandoned fork from long ago is ordinary clutter.
  const file = path.join(core.snapshotBase(s.project), meta.id, 'meta.json');
  fs.writeFileSync(file, JSON.stringify({ ...meta, createdAt: new Date(Date.now() - 3 * 3600e3).toISOString() }));
  core.pruneSnapshots(s.project, 2);
  assert.ok(!core.listSnapshots(s.project).some((m) => m.id === meta.id), 'old fork pruned');
});

test('a full revert never clones a .git entry out of snapshot data over the real repository', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  fs.mkdirSync(s.p('.git')); s.write('.git/HEAD', 'ref: refs/heads/main\n');
  const m = core.takeSnapshot(s.project, { name: 'base' });
  // Something (a linked fork, a hand copy) left a gitfile inside the snapshot data.
  fs.writeFileSync(path.join(core.snapshotDir(s.project, m.id), '.git'), 'gitdir: /elsewhere/.git\n');
  s.write('a.txt', 'two');
  core.revertSnapshot(s.project, m.id);
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.ok(fs.statSync(s.p('.git')).isDirectory(), 'real .git directory untouched');
  assert.strictEqual(s.read('.git/HEAD'), 'ref: refs/heads/main\n');
});

// ---------- try: defaults, --git, progress ----------

test('try uses the saved check by default, and --no-check skips it', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  core.writeCheckConfig(s.project, { command: 'test -f must-exist', auto: false });
  assert.match(fails(s, 'try', 'printf two > a.txt'), /Check "test -f must-exist" failed/);
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.match(cli(s, 'try', '--no-check', 'printf two > a.txt'), /Try passed/);
  assert.strictEqual(s.read('a.txt'), 'two');
});

test('try prints progress on stderr while the command output streams', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const r = spawnSync(process.execPath, [BIN('agent-undo.cjs'), 'try', 'echo building', '--check', 'echo checking'], { cwd: s.project, env: s.env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /building[\s\S]*checking/, 'command and check output stream through');
  assert.match(r.stderr, /fork .* ready/i);
  assert.match(r.stderr, /running: echo building/);
  assert.match(r.stderr, /check: echo checking/);
});

test('try --git links the fork to the repository for the run, and no gitfile survives into the fork or the project', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const git = (...args) => execFileSync('git', args, { cwd: s.project, encoding: 'utf8', env: { ...s.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q'); s.write('a.txt', 'one'); git('add', '.'); git('commit', '-qm', 'init');
  // Without --git the fork is not a repository, even with a repository above the store (a dotfiles repo in $HOME).
  execFileSync('git', ['init', '-q'], { cwd: s.tmp });
  const plain = core.tryInFork(s.project, 'git rev-parse --show-toplevel > top.txt', { stdio: 'pipe' });
  assert.strictEqual(plain.ok, false);
  // With it, git inside the fork sees the fork as the worktree of the real repository.
  const linked = core.tryInFork(s.project, 'git rev-parse --show-toplevel > top.txt && git log --oneline | wc -l | tr -d " " > commits.txt', { stdio: 'pipe', git: true });
  assert.strictEqual(linked.ok, true, linked.command.stderr);
  assert.strictEqual(s.read('top.txt').trim(), s.project, 'fork path was rewritten to the project path');
  assert.strictEqual(s.read('commits.txt').trim(), '1');
  assert.ok(fs.statSync(s.p('.git')).isDirectory(), 'the real .git is still a directory');
  // A failed linked try keeps the fork, minus the gitfile.
  const failed = core.tryInFork(s.project, 'git status >/dev/null && exit 9', { stdio: 'pipe', git: true });
  assert.strictEqual(failed.stage, 'command');
  assert.ok(!fs.existsSync(path.join(core.snapshotDir(s.project, failed.fork.id), '.git')), 'no gitfile left in the kept fork');
});
