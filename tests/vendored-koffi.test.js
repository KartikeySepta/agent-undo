const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, sandbox } = require('./helpers');

const VENDOR = path.join(ROOT, 'vendor', 'koffi-runtime');

test('vendored koffi is the version the lockfile pins, with both macOS natives and its license', () => {
  const pinned = require(path.join(ROOT, 'package-lock.json')).packages['node_modules/koffi'].version;
  assert.strictEqual(require(path.join(VENDOR, 'koffi', 'package.json')).version, pinned);
  for (const arch of ['arm64', 'x64']) {
    assert.ok(fs.existsSync(path.join(VENDOR, '@koromix', `koffi-darwin-${arch}`, `darwin_${arch}`, 'koffi.node')), `darwin-${arch} native`);
    assert.strictEqual(require(path.join(VENDOR, '@koromix', `koffi-darwin-${arch}`, 'package.json')).version, pinned);
  }
  assert.match(fs.readFileSync(path.join(VENDOR, 'koffi', 'LICENSE.txt'), 'utf8'), /MIT|Permission is hereby granted/);
});

test('a plugin install with no node_modules still gets directory-level clonefile', { skip: process.platform !== 'darwin' }, (t) => {
  const s = sandbox(); t.after(s.cleanup);
  // Exactly what a git-installed plugin has: bin/ and vendor/, and no node_modules anywhere above.
  const plugin = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agent-undo-plugin-'));
  t.after(() => fs.rmSync(plugin, { recursive: true, force: true }));
  fs.cpSync(path.join(ROOT, 'bin'), path.join(plugin, 'bin'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'vendor'), path.join(plugin, 'vendor'), { recursive: true });
  s.write('f.txt', 'one');

  const run = (...args) => spawnSync(process.execPath, [path.join(plugin, 'bin', 'agent-undo.cjs'), ...args], { cwd: s.project, env: s.env, encoding: 'utf8' });
  assert.match(run('doctor').stdout, /clone engine\s+clonefile\(2\)/);
  assert.match(run('snapshot', 'base').stdout, /\(clonefile, \d+ms\)/);

  // And the opt-out still works.
  const off = spawnSync(process.execPath, [path.join(plugin, 'bin', 'agent-undo.cjs'), 'doctor'], { cwd: s.project, env: { ...s.env, AGENT_UNDO_NO_FFI: '1' }, encoding: 'utf8' });
  assert.match(off.stdout, /cp -c per file/);
});
