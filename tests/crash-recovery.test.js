const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BIN, ROOT, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

/** Run a full revert in a child that is SIGKILLed the moment the recovery marker reaches `phase`. */
function revertKilledAt(s, phase) {
  const script = `
    const fs = require('fs');
    const core = require(${JSON.stringify(path.join(ROOT, 'bin', 'core.cjs'))});
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(to).endsWith('.reverting.json') && JSON.parse(fs.readFileSync(to, 'utf8')).phase === ${JSON.stringify(phase)}) {
        process.kill(process.pid, 'SIGKILL');
      }
    };
    core.revertSnapshot(${JSON.stringify(s.project)}, 'base');
  `;
  const r = spawnSync(process.execPath, ['-e', script], { env: s.env, encoding: 'utf8' });
  assert.strictEqual(r.signal, 'SIGKILL', `child should have been killed at ${phase}: ${r.stderr}`);
}

function seed(s) {
  s.write('.agentundoignore', '.env.local\n');
  s.write('.env.local', 'SECRET=1');
  s.write('a.txt', 'v1');
  s.write('src/b.js', 'v1');
  core.takeSnapshot(s.project, { name: 'base' });
  s.write('a.txt', 'v2-agent');
  s.write('src/b.js', 'v2-agent');
  s.write('new.txt', 'created later');
}

const state = (s) => ({ a: s.read('a.txt'), b: s.read('src/b.js'), env: s.read('.env.local'), neu: s.exists('new.txt') });
const BEFORE_REVERT = { a: 'v2-agent', b: 'v2-agent', env: 'SECRET=1', neu: true };

for (const phase of ['stashing', 'moving', 'restoring']) {
  test(`a revert killed at "${phase}" is detected and fully undone by repair`, (t) => {
    const s = sandbox(); t.after(s.cleanup); seed(s);
    revertKilledAt(s, phase);

    const cut = core.interruptedRevert(s.project);
    assert.ok(cut, 'doctor can see the interrupted revert');
    assert.strictEqual(cut.phase, phase);
    const doctor = spawnSync(process.execPath, [BIN('agent-undo.cjs'), 'doctor'], { cwd: s.project, env: s.env, encoding: 'utf8' });
    assert.match(doctor.stdout, /interrupted.*doctor --repair/);
    assert.strictEqual(doctor.status, 1);

    const repair = spawnSync(process.execPath, [BIN('agent-undo.cjs'), 'doctor', '--repair'], { cwd: s.project, env: s.env, encoding: 'utf8' });
    assert.match(repair.stdout, /Interrupted revert to .* back to its state before/);
    assert.deepStrictEqual(state(s), BEFORE_REVERT, 'nothing was lost: the project is exactly as it was before the revert');
    assert.strictEqual(core.interruptedRevert(s.project), null);
    assert.strictEqual(core.repairInterruptedRevert(s.project), null, 'repair is idempotent');
  });
}

test('a revert killed after the restore finished only needs its ignored paths put back', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  revertKilledAt(s, 'stash');

  assert.ok(!s.exists('.env.local'), 'the ignored file is still parked outside the tree');
  assert.strictEqual(s.read('a.txt'), 'v1', 'the snapshot itself was fully restored');
  assert.match(core.repairInterruptedRevert(s.project), /had finished/);
  assert.deepStrictEqual(state(s), { a: 'v1', b: 'v1', env: 'SECRET=1', neu: false });
});

test('repair refuses while a live revert holds the lock, and a normal revert leaves no marker', (t) => {
  const s = sandbox(); t.after(s.cleanup); seed(s);
  core.revertSnapshot(s.project, 'base');
  assert.strictEqual(core.interruptedRevert(s.project), null);
  assert.strictEqual(s.read('.env.local'), 'SECRET=1');

  fs.writeFileSync(path.join(core.snapshotBase(s.project), '.reverting.json'), JSON.stringify({ phase: 'restoring', snap: 'x', stash: '/nope', ignored: [], backup: null, backupMode: null, at: Date.now() }));
  fs.writeFileSync(path.join(core.snapshotBase(s.project), '.lock'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.strictEqual(core.interruptedRevert(s.project), null, 'a live holder means the revert is still running, not interrupted');
  assert.throws(() => core.repairInterruptedRevert(s.project), /Another snapshot or revert is running/);
});
