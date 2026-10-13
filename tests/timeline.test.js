const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const cli = (s, ...args) => execFileSync(process.execPath, [BIN('agent-undo.cjs'), ...args], { cwd: s.project, env: s.env, encoding: 'utf8' });
const fails = (s, ...args) => {
  try { cli(s, ...args); } catch (e) { return e.stderr.toString() + e.stdout.toString(); }
  throw new Error(`expected "${args.join(' ')}" to fail`);
};
const CHECK = 'test -f ok.txt';

/** Four snapshots: ok, ok, broken (ok.txt deleted), broken. Live tree equals the last one. */
function brokenTimeline(s) {
  s.write('ok.txt', ''); s.write('a.txt', '1\n');
  const s1 = core.takeSnapshot(s.project, { name: 's1' });
  s.write('a.txt', '2\n');
  const s2 = core.takeSnapshot(s.project, { name: 's2' });
  fs.rmSync(s.p('ok.txt')); s.write('b.txt', 'new\n');
  const s3 = core.takeSnapshot(s.project, { reason: 'hook: rm ok.txt', trigger: 'hook' });
  s.write('a.txt', '3\n');
  const s4 = core.takeSnapshot(s.project, { name: 's4' });
  return { s1, s2, s3, s4 };
}

// ---------- bisect ----------

test('bisect finds the last green and first red snapshot and what changed between them', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const { s2, s3 } = brokenTimeline(s);
  const r = core.bisect(s.project, { check: CHECK, stdio: 'pipe' });
  assert.strictEqual(r.outcome, 'found');
  assert.strictEqual(r.lastGreen.id, s2.id);
  assert.strictEqual(r.firstRed.id, s3.id);
  assert.deepStrictEqual(r.changed, { added: ['b.txt'], modified: [], deleted: ['ok.txt'] });
  assert.ok(r.tested.length <= 4 && r.tested.length >= 3, `binary search ran ${r.tested.length} checks`);
  // Results are remembered on the snapshots, so a re-run is free.
  const marks = Object.fromEntries(core.listSnapshots(s.project).filter((m) => m.check).map((m) => [m.id, m.check.ok]));
  assert.strictEqual(marks[s2.id], true);
  assert.strictEqual(marks[s3.id], false);
  const again = core.bisect(s.project, { check: CHECK, stdio: 'pipe' });
  assert.strictEqual(again.tested.length, 0);
  assert.strictEqual(again.lastGreen.id, s2.id);
  // Snapshots themselves were not touched by the checks.
  assert.ok(!fs.existsSync(`${core.snapshotDir(s.project, s2.id)}/.bisect`), 'nothing written into the snapshot');
});

test('bisect treats the working tree as the newest candidate when it differs from the last snapshot', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('ok.txt', '');
  const s1 = core.takeSnapshot(s.project, { name: 's1' });
  fs.rmSync(s.p('ok.txt'));
  const r = core.bisect(s.project, { check: CHECK, stdio: 'pipe' });
  assert.strictEqual(r.outcome, 'found');
  assert.strictEqual(r.lastGreen.id, s1.id);
  assert.strictEqual(r.firstRed, 'now');
  assert.deepStrictEqual(r.changed, { added: [], modified: [], deleted: ['ok.txt'] });
  assert.ok(!s.exists('ok.txt'), 'the live tree is left alone');
});

test('bisect reports all-green and all-red instead of guessing', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('ok.txt', '');
  core.takeSnapshot(s.project, { name: 'a' }); s.write('x', '1'); core.takeSnapshot(s.project, { name: 'b' });
  assert.strictEqual(core.bisect(s.project, { check: CHECK, stdio: 'pipe' }).outcome, 'all-green');
  assert.strictEqual(core.bisect(s.project, { check: 'exit 1', stdio: 'pipe' }).outcome, 'all-red');
  const empty = sandbox(); t.after(empty.cleanup);
  assert.strictEqual(core.bisect(empty.project, { check: CHECK, stdio: 'pipe' }).outcome, 'nothing');
});

test('bisect uses stored marks, skips forks, and honours --good/--bad bounds', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const { s1, s2, s3, s4 } = brokenTimeline(s);
  core.fork(s.project, 'try: something');
  core.markSnapshot(s.project, s1.id, { ok: true, command: CHECK });
  core.markSnapshot(s.project, s4.id, { ok: false, command: CHECK });
  core.markSnapshot(s.project, s2.id, { ok: false, command: 'some other check' }); // not evidence for CHECK: re-run
  const r = core.bisect(s.project, { check: CHECK, stdio: 'pipe' });
  assert.deepStrictEqual(r.tested.map((x) => x.id).sort(), [s2.id, s3.id].sort());
  assert.strictEqual(r.firstRed.id, s3.id);
  assert.ok(!r.tested.some((x) => x.trigger === 'fork'));
  const bounded = core.bisect(s.project, { check: CHECK, good: s2.id, bad: s3.id, stdio: 'pipe', fresh: true });
  assert.strictEqual(bounded.lastGreen.id, s2.id);
  assert.strictEqual(bounded.firstRed.id, s3.id);
  assert.strictEqual(bounded.tested.length, 2, 'fresh re-runs both bounds');
});

test('cli and mcp: bisect prints progress and a report with the revert command', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const { s2, s3 } = brokenTimeline(s);
  const out = cli(s, 'bisect', '--check', CHECK);
  assert.match(out, /testing .*✗ red/);
  assert.match(out, new RegExp(`Last green: ${s2.id}`));
  assert.match(out, new RegExp(`First red:  ${s3.id}.*hook: rm ok.txt`));
  assert.match(out, /- ok\.txt/);
  assert.match(out, new RegExp(`agent-undo revert ${s2.id} --yes`));
  assert.match(fails(s, 'bisect'), /No check command saved/);

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN('agent-undo-mcp.cjs')], cwd: s.project, env: s.env, stderr: 'ignore' }));
  t.after(() => client.close());
  const text = (await client.callTool({ name: 'bisect', arguments: { check: CHECK } })).content[0].text;
  assert.match(text, new RegExp(`Last green: ${s2.id}`));
  assert.match(text, /revert_environment with snapshot/);
});

// ---------- replay ----------

test('replay lists each step of the timeline with what changed, ending at the working tree', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const { s1, s2, s3, s4 } = brokenTimeline(s);
  core.fork(s.project, 'try: ignored');
  let steps = core.replay(s.project);
  assert.strictEqual(steps.length, 3, 'live tree equals s4: three steps');
  assert.deepStrictEqual(steps.map((x) => [x.from.id, x.to.id]), [[s1.id, s2.id], [s2.id, s3.id], [s3.id, s4.id]]);
  assert.deepStrictEqual(steps[1].changed, { added: ['b.txt'], modified: [], deleted: ['ok.txt'] });
  s.write('a.txt', 'live');
  steps = core.replay(s.project);
  assert.strictEqual(steps.length, 4);
  assert.strictEqual(steps[3].to, 'now');
  assert.deepStrictEqual(steps[3].changed, { added: [], modified: ['a.txt'], deleted: [] });
  assert.strictEqual(core.replay(s.project, { last: 2 }).length, 2);
  assert.deepStrictEqual(core.replay(sandbox().project), []);
});

test('cli: replay prints a numbered flipbook; --file shows that file\'s diff at each step it changed', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const { s1, s3 } = brokenTimeline(s);
  core.markSnapshot(s.project, s1.id, { ok: true, command: CHECK });
  core.markSnapshot(s.project, s3.id, { ok: false, command: CHECK });
  s.write('a.txt', 'live\n');
  const out = cli(s, 'replay');
  assert.match(out, new RegExp(`#1  ${s1.id}\\s+\\[manual, .*\\]\\s+✓ green`));
  assert.match(out, new RegExp(`#3  ${s3.id}\\s+\\[hook, .*\\]\\s+✗ red\\s+hook: rm ok.txt`));
  assert.match(out, /\+1 ~0 -1\s+\+ b\.txt\s+- ok\.txt/);
  assert.match(out, /#5  now \(working tree\)\n\s+\+0 ~1 -0\s+~ a\.txt/);
  const one = cli(s, 'replay', '--last', '1');
  assert.doesNotMatch(one, /#2 /);
  assert.match(one, /now \(working tree\)/);
  const file = cli(s, 'replay', '--file', 'a.txt');
  assert.match(file, /^-1\n\+2$/m, 's1 -> s2 changed a.txt from 1 to 2');
  assert.match(file, /^-3\n\+live$/m, 's4 -> now');
  assert.doesNotMatch(file, /b\.txt/, 'only the asked file');
  assert.match(cli(s, 'replay', '--file', 'b.txt'), /@@ -0,0 \+1 @@\n\+new/, 'an added file diffs against nothing');
});

test('bisect sweeps scratch directories left by a killed earlier bisect', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  brokenTimeline(s);
  const stale = `${core.snapshotBase(s.project)}/.bisect-999999`;
  fs.mkdirSync(stale); fs.writeFileSync(`${stale}/junk`, 'x');
  core.bisect(s.project, { check: CHECK, stdio: 'pipe' });
  assert.ok(!fs.existsSync(stale), 'stale scratch removed');
  assert.strictEqual(fs.readdirSync(core.snapshotBase(s.project)).filter((e) => e.startsWith('.bisect-')).length, 0, 'own scratch removed too');
});
