const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

function seed(s) {
  s.write('.git/HEAD', 'ref: main');
  s.write('node_modules/x/.git/HEAD', 'nested');
  s.write('important.txt', 'Original');
  s.write('src/app.js', 'v1');
}

test('snapshot → break → diff → revert → undo the revert', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  const snap = core.takeSnapshot(s.project, { name: 'base' });

  s.write('important.txt', 'RUINED');
  s.write('garbage.js', 'slop');
  fs.rmSync(s.p('node_modules'), { recursive: true });

  const d = core.diffSnapshot(s.project);
  assert.deepStrictEqual(d, {
    added: ['garbage.js'], modified: ['important.txt'], deleted: [path.join('node_modules', 'x', '.git', 'HEAD')],
  });

  const { restored, backup } = core.revertSnapshot(s.project, 'base');
  assert.strictEqual(restored.id, snap.id);
  assert.strictEqual(s.read('important.txt'), 'Original');
  assert.ok(!s.exists('garbage.js'));
  assert.strictEqual(s.read('node_modules/x/.git/HEAD'), 'nested', 'nested .git dirs are restored');
  assert.strictEqual(s.read('.git/HEAD'), 'ref: main', 'top-level .git is never touched');

  core.revertSnapshot(s.project, backup.id);
  assert.strictEqual(s.read('important.txt'), 'RUINED');
  assert.ok(s.exists('garbage.js'));
});

test('top-level .git is excluded from snapshots', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  const snap = core.takeSnapshot(s.project);
  assert.ok(!fs.existsSync(path.join(core.snapshotBase(s.project), snap.id, 'data', '.git')));
});

test('uses directory-level clonefile on macOS', { skip: process.platform !== 'darwin' || !!process.env.AGENT_UNDO_NO_FFI }, (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  assert.strictEqual(core.takeSnapshot(s.project).mode, 'clonefile');
});

test('symlinks are restored as symlinks', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  fs.symlinkSync('important.txt', s.p('link'));
  core.takeSnapshot(s.project);
  fs.rmSync(s.p('link'));
  core.revertSnapshot(s.project);
  assert.strictEqual(fs.readlinkSync(s.p('link')), 'important.txt');
});

test('refuses / and the home directory', () => {
  assert.throws(() => core.takeSnapshot(os.homedir()), /Refusing/);
  assert.throws(() => core.takeSnapshot('/'), /Refusing/);
});

test('.agentundoignore: ignored paths are not snapshotted and survive revert untouched', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  s.write('.agentundoignore', '.env.local\nbuild/\n');
  s.write('.env.local', 'SECRET=1');
  s.write('packages/a/build/out.js', 'built-v1');
  s.write('packages/a/index.js', 'a-v1');

  const snap = core.takeSnapshot(s.project);
  const data = path.join(core.snapshotBase(s.project), snap.id, 'data');
  assert.ok(!fs.existsSync(path.join(data, '.env.local')));
  assert.ok(!fs.existsSync(path.join(data, 'packages/a/build')));
  assert.ok(fs.existsSync(path.join(data, 'packages/a/index.js')));

  s.write('.env.local', 'SECRET=2');
  s.write('packages/a/build/out.js', 'built-v2');
  s.write('packages/a/index.js', 'a-BROKEN');
  assert.deepStrictEqual(core.diffSnapshot(s.project).modified, [path.join('packages', 'a', 'index.js')], 'diff skips ignored paths');

  core.revertSnapshot(s.project);
  assert.strictEqual(s.read('packages/a/index.js'), 'a-v1');
  assert.strictEqual(s.read('.env.local'), 'SECRET=2', 'ignored file kept as-is');
  assert.strictEqual(s.read('packages/a/build/out.js'), 'built-v2', 'nested ignored dir kept as-is');
});

test('revert --only restores just the given paths', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  core.takeSnapshot(s.project);
  s.write('important.txt', 'RUINED');
  s.write('src/app.js', 'v2-good-work');
  s.write('src/new.js', 'created later');

  core.revertSnapshot(s.project, undefined, { only: ['important.txt', 'src/new.js'] });
  assert.strictEqual(s.read('important.txt'), 'Original');
  assert.ok(!s.exists('src/new.js'), 'a path absent from the snapshot is removed');
  assert.strictEqual(s.read('src/app.js'), 'v2-good-work', 'other work untouched');
});

test('revert --only rejects paths outside the project or inside .git', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  core.takeSnapshot(s.project);
  for (const bad of ['../outside', '/etc/passwd', '.git/HEAD', '.']) {
    assert.throws(() => core.revertSnapshot(s.project, undefined, { only: [bad] }), /not a path inside the project/, bad);
  }
});

test('lock: a live holder blocks, a dead holder is reclaimed', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  const lock = path.join(core.snapshotBase(s.project), '.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });

  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.throws(() => core.takeSnapshot(s.project), core.BusyError);

  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 7, at: Date.now() }));
  assert.ok(core.takeSnapshot(s.project).id);
  assert.ok(!fs.existsSync(lock), 'lock released');
});

test('prune keeps named snapshots and the newest N unnamed', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  core.takeSnapshot(s.project, { name: 'keep-me' });
  for (let i = 0; i < 4; i++) core.takeSnapshot(s.project, { keep: 100 });
  assert.strictEqual(core.pruneSnapshots(s.project, 2), 2);
  const names = core.listSnapshots(s.project).map((m) => m.name ?? 'unnamed');
  assert.deepStrictEqual(names, ['keep-me', 'unnamed', 'unnamed']);
});

test('copy fallback honours the size guard and leaves no partial snapshot', { skip: process.platform === 'win32' }, (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  const fakeBin = path.join(s.tmp, 'fakebin');
  fs.mkdirSync(fakeBin);
  // Simulate a filesystem without CoW: cp refuses -c / --reflink, plain copies still work.
  fs.writeFileSync(path.join(fakeBin, 'cp'), '#!/bin/sh\nfor a in "$@"; do case "$a" in -c|--reflink=*) exit 1;; esac; done\nexec /bin/cp "$@"\n', { mode: 0o755 });
  const env = { ...s.env, PATH: `${fakeBin}:${process.env.PATH}`, AGENT_UNDO_NO_FFI: '1' };

  const tiny = spawnSync(process.execPath, [BIN('agent-undo.cjs'), 'snapshot'], { cwd: s.project, env: { ...env, AGENT_UNDO_MAX_COPY_MB: '0.000001' }, encoding: 'utf8' });
  assert.notStrictEqual(tiny.status, 0);
  assert.match(tiny.stderr, /No copy-on-write/);
  assert.deepStrictEqual(core.listSnapshots(s.project), []);
  const base = core.snapshotBase(s.project);
  assert.deepStrictEqual(fs.existsSync(base) ? fs.readdirSync(base).filter((f) => !f.startsWith('.')) : [], []);

  const ok = execFileSync(process.execPath, [BIN('agent-undo.cjs'), 'snapshot'], { cwd: s.project, env, encoding: 'utf8' });
  assert.match(ok, /full copy/);
});

test('a revert that fails mid-restore rolls back and leaves the project unchanged', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, (t) => {
  const s = sandbox(); seed(s);
  const snap = core.takeSnapshot(s.project);
  s.write('important.txt', 'current work');
  s.write('new.js', 'new');

  // Make one snapshot entry unreadable so restoring it fails partway.
  const locked = path.join(core.snapshotBase(s.project), snap.id, 'data', 'src');
  fs.chmodSync(locked, 0o000);
  t.after(() => { fs.chmodSync(locked, 0o755); s.cleanup(); });

  assert.throws(() => core.revertSnapshot(s.project), /rolled back, project unchanged/);
  assert.strictEqual(s.read('important.txt'), 'current work');
  assert.strictEqual(s.read('new.js'), 'new');
  assert.strictEqual(s.read('src/app.js'), 'v1');
  assert.strictEqual(s.read('.git/HEAD'), 'ref: main');
  assert.ok(!fs.existsSync(path.join(core.snapshotBase(s.project), '.lock')));
});

test('pruned snapshots disappear instantly and are deleted in the background', async (t) => {
  const s = sandbox(); seed(s);
  t.after(s.cleanup);
  delete process.env.AGENT_UNDO_SYNC_DELETE;
  t.after(() => { process.env.AGENT_UNDO_SYNC_DELETE = '1'; });

  for (let i = 0; i < 3; i++) core.takeSnapshot(s.project, { keep: 100 });
  core.pruneSnapshots(s.project, 1);
  assert.strictEqual(core.listSnapshots(s.project).length, 1, 'gone from the listing immediately');

  const base = core.snapshotBase(s.project);
  const trash = () => fs.readdirSync(base).filter((f) => f.startsWith('.trash-'));
  for (let i = 0; i < 50 && trash().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(trash(), [], 'background deleter removed the trash');
});

test('partial revert accepts names that merely start with two dots, and still rejects escapes', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('..cache/blob', 'good');
  core.takeSnapshot(s.project, { name: 'base' });
  s.write('..cache/blob', 'bad');

  core.revertSnapshot(s.project, 'base', { only: ['..cache'] });
  assert.strictEqual(s.read('..cache/blob'), 'good');

  for (const bad of ['..', '../sibling', path.join(s.tmp, 'store'), '.git/HEAD']) {
    assert.throws(() => core.revertSnapshot(s.project, 'base', { only: [bad] }), /not a path inside the project/, bad);
  }
});

test('partial revert refuses to follow a symlink out of the project', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const outside = path.join(s.tmp, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep me');
  fs.symlinkSync(outside, s.p('link'));
  s.write('a.txt', 'one');
  core.takeSnapshot(s.project, { name: 'base' });

  assert.throws(() => core.previewRevert(s.project, 'base', { only: ['link/precious.txt'] }), /not a path inside the project/);
  assert.throws(() => core.revertSnapshot(s.project, 'base', { only: ['link/precious.txt'] }), /not a path inside the project/);
  assert.strictEqual(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep me', 'the file outside the project survives');

  // The symlink itself lives in the project, so it can still be reverted.
  fs.rmSync(s.p('link'));
  core.revertSnapshot(s.project, 'base', { only: ['link'] });
  assert.ok(fs.lstatSync(s.p('link')).isSymbolicLink());
});

test('partial revert never touches paths excluded by .agentundoignore', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('.agentundoignore', 'dist/\n.env.local\n');
  s.write('dist/out.js', 'built');
  s.write('.env.local', 'SECRET=1');
  s.write('src/a.js', 'v1');
  core.takeSnapshot(s.project, { name: 'base' });
  s.write('src/a.js', 'v2');

  for (const target of ['dist', 'dist/out.js', '.env.local']) {
    assert.throws(() => core.revertSnapshot(s.project, 'base', { only: [target] }), /excluded by \.agentundoignore/, target);
    assert.throws(() => core.previewRevert(s.project, 'base', { only: [target] }), /excluded by \.agentundoignore/, target);
  }
  assert.strictEqual(s.read('dist/out.js'), 'built');
  assert.strictEqual(s.read('.env.local'), 'SECRET=1');

  core.revertSnapshot(s.project, 'base', { only: ['src'] });
  assert.strictEqual(s.read('src/a.js'), 'v1');
});
