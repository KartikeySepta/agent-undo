const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const cli = (s, ...args) => execFileSync(process.execPath, [BIN('agent-undo.cjs'), ...args], { cwd: s.project, env: s.env, encoding: 'utf8' });
const fails = (s, ...args) => {
  try { cli(s, ...args); } catch (e) { return e.stderr.toString() + e.stdout.toString(); }
  throw new Error(`expected "${args.join(' ')}" to fail`);
};

test('markSnapshot records a check result and last-green resolves to the newest green snapshot', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const a = core.takeSnapshot(s.project, { name: 'a' });
  assert.throws(() => core.resolveSnapshot(s.project, 'last-green'), /No green snapshot/);
  core.markSnapshot(s.project, a.id, { ok: true, command: 'npm test' });
  const b = core.takeSnapshot(s.project, { name: 'b' });
  core.markSnapshot(s.project, b.id, { ok: false, command: 'npm test' });
  core.takeSnapshot(s.project, { name: 'c' });
  const marked = core.listSnapshots(s.project);
  assert.strictEqual(marked[0].check.ok, true);
  assert.strictEqual(marked[0].check.command, 'npm test');
  assert.ok(Date.parse(marked[0].check.at) > 0);
  assert.strictEqual(marked[1].check.ok, false);
  assert.strictEqual(marked[2].check, undefined);
  assert.strictEqual(core.resolveSnapshot(s.project, 'last-green').id, a.id);
});

test('runCheck marks the snapshot that matches the tree, taking one first when the tree moved', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const first = core.takeSnapshot(s.project, { name: 'first' });
  // Unchanged tree, passing check: the existing snapshot is the green one.
  let r = core.runCheck(s.project, 'test -f a.txt', { stdio: 'pipe' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.snapshot.id, first.id);
  assert.strictEqual(core.listSnapshots(s.project).length, 1);
  // Tree moved, passing check: a new snapshot is taken and marked.
  s.write('b.txt', 'two');
  r = core.runCheck(s.project, 'test -f b.txt', { stdio: 'pipe' });
  assert.strictEqual(r.ok, true);
  assert.notStrictEqual(r.snapshot.id, first.id);
  assert.strictEqual(r.snapshot.trigger, 'check');
  assert.strictEqual(core.resolveSnapshot(s.project, 'last-green').id, r.snapshot.id);
  // Unchanged tree, failing check: the matching snapshot is marked red.
  r = core.runCheck(s.project, 'exit 4', { stdio: 'pipe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.run.status, 4);
  assert.strictEqual(core.listSnapshots(s.project).at(-1).check.ok, false);
  assert.strictEqual(core.resolveSnapshot(s.project, 'last-green').id, first.id, 'last-green moves back to the older green');
  // Tree moved, failing check: nothing is snapshotted or marked.
  s.write('c.txt', 'three');
  r = core.runCheck(s.project, 'exit 1', { stdio: 'pipe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.snapshot, null);
  assert.strictEqual(core.listSnapshots(s.project).length, 2);
});

test('check config is saved per project and used by default', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  assert.strictEqual(core.readCheckConfig(s.project), null);
  core.writeCheckConfig(s.project, { command: 'npm test', auto: true });
  assert.deepStrictEqual(core.readCheckConfig(s.project), { command: 'npm test', auto: true });
  const r = core.runCheck(s.project, undefined, { stdio: 'pipe' });
  assert.strictEqual(r.command, 'npm test', 'the saved command is the default');
  assert.strictEqual(r.ok, false, 'no test script in this sandbox');
  assert.strictEqual(r.snapshot, null);
});

test('cli: check --set saves, check runs it and marks, list shows the mark, revert last-green works', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  assert.match(fails(s, 'check'), /No check command saved/);
  assert.match(cli(s, 'check', '--set', 'test -f ok.txt', '--auto'), /Saved check "test -f ok.txt" \(auto: on\)/);
  assert.deepStrictEqual(core.readCheckConfig(s.project), { command: 'test -f ok.txt', auto: true });
  assert.match(fails(s, 'check'), /❌ Check "test -f ok.txt" failed \(exit 1\)/);
  s.write('ok.txt', '');
  assert.match(cli(s, 'check'), /✅ Check passed: .* is green/);
  assert.match(cli(s, 'list'), /✓ green/);
  s.write('a.txt', 'broken');
  assert.match(fails(s, 'check', 'exit 1'), /❌ Check "exit 1" failed \(exit 1\)\.$/m, 'a moved, failing tree is not snapshotted or marked');
  cli(s, 'revert', 'last-green', '--yes');
  assert.strictEqual(s.read('a.txt'), 'one');
});

test('mcp: take_snapshot(green) marks it, and last-green works as a snapshot reference', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN('agent-undo-mcp.cjs')], cwd: s.project, env: s.env, stderr: 'ignore' }));
  t.after(() => client.close());
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  assert.match(await call('take_snapshot', { name: 'good', green: true }), /marked green/);
  assert.strictEqual(core.listSnapshots(s.project)[0].check.ok, true);
  s.write('a.txt', 'two');
  await call('take_snapshot', { name: 'later' });
  assert.match(await call('revert_environment', { snapshot: 'last-green' }), /Reverting to .*-good/);
  assert.match(await call('list_snapshots'), /-good .*green/);
});

test('hook: Stop runs the saved check at paranoid level when auto is on, and marks the result', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  core.takeSnapshot(s.project, { name: 'turn' });
  const run = (env) => spawnSync(process.execPath, [BIN('hook-stop.cjs')], { input: JSON.stringify({ hook_event_name: 'Stop', cwd: s.project }), env: { ...s.env, ...env }, encoding: 'utf8' });
  // No saved check: nothing happens.
  assert.strictEqual(run({ AGENT_UNDO_LEVEL: 'paranoid' }).status, 0);
  assert.strictEqual(core.listSnapshots(s.project)[0].check, undefined);
  core.writeCheckConfig(s.project, { command: 'test -f a.txt', auto: false });
  run({ AGENT_UNDO_LEVEL: 'paranoid' });
  assert.strictEqual(core.listSnapshots(s.project)[0].check, undefined, 'auto off: no check');
  core.writeCheckConfig(s.project, { command: 'test -f a.txt', auto: true });
  run({ AGENT_UNDO_LEVEL: 'full' });
  assert.strictEqual(core.listSnapshots(s.project)[0].check, undefined, 'only paranoid runs checks every turn');
  const r = run({ AGENT_UNDO_LEVEL: 'paranoid' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(core.listSnapshots(s.project)[0].check.ok, true);
});

test('prune keeps the newest green snapshot, so last-green survives a busy session', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  const green = core.takeSnapshot(s.project, { keep: 100 });
  core.markSnapshot(s.project, green.id, { ok: true, command: 'x' });
  for (let i = 0; i < 12; i++) { s.write('a.txt', `v${i}`); core.takeSnapshot(s.project, { keep: 100 }); }
  assert.strictEqual(core.pruneSnapshots(s.project, 3), 9, '13 unnamed, the green one exempt, keep 3: 9 go');
  assert.strictEqual(core.resolveSnapshot(s.project, 'last-green').id, green.id);
  // An older green gives way once a newer green exists.
  const newer = core.resolveSnapshot(s.project, 'latest');
  core.markSnapshot(s.project, newer.id, { ok: true, command: 'x' });
  core.pruneSnapshots(s.project, 1);
  assert.strictEqual(core.resolveSnapshot(s.project, 'last-green').id, newer.id);
  assert.ok(!core.listSnapshots(s.project).some((m) => m.id === green.id), 'the older green is prunable again');
});

test('doctor and undo_status report the saved check and the last green snapshot', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  assert.match(cli(s, 'doctor'), /check\s+none saved: agent-undo check --set "<command>"/);
  core.writeCheckConfig(s.project, { command: 'test -f a.txt', auto: true });
  assert.match(cli(s, 'doctor'), /check\s+"test -f a.txt" \(auto on\), no green snapshot yet/);
  const r = core.runCheck(s.project, undefined, { stdio: 'pipe' });
  assert.match(cli(s, 'doctor'), new RegExp(`check\\s+"test -f a.txt" \\(auto on\\), last green ${r.snapshot.id}`));
  const st = JSON.parse(cli(s, 'stats', '--json'));
  assert.deepStrictEqual(st.check, { command: 'test -f a.txt', auto: true });
  assert.strictEqual(st.lastGreen, r.snapshot.id);
});
