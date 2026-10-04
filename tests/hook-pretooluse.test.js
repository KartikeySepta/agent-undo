const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const fire = (s, payload) => spawnSync(process.execPath, [BIN('hook-pretooluse.cjs')], {
  input: typeof payload === 'string' ? payload : JSON.stringify(payload), env: s.env, encoding: 'utf8',
});
const bash = (s, command) => fire(s, { tool_name: 'Bash', cwd: s.project, tool_input: { command } });

test('snapshots before risky commands only', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  for (const safe of ['ls -la', 'npm test', 'git status', 'cat package.json']) {
    assert.strictEqual(bash(s, safe).status, 0);
  }
  assert.strictEqual(core.listSnapshots(s.project).length, 0);

  bash(s, 'npm install left-pad');
  const snaps = core.listSnapshots(s.project);
  assert.strictEqual(snaps.length, 1);
  assert.match(snaps[0].reason, /^auto: npm install left-pad/);
});

test('absorbs bursts of risky commands, but older non-hook snapshots do not suppress it', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  core.takeSnapshot(s.project, { trigger: 'session' });
  bash(s, 'rm -rf build');
  bash(s, 'git reset --hard');
  assert.deepStrictEqual(core.listSnapshots(s.project).map((m) => m.trigger), ['session', 'hook']);
});

test('matches the risky patterns it claims to', () => {
  const s = sandbox();
  const risky = ['rm -rf node_modules', 'rm -f a.txt', 'pnpm add zod', 'yarn remove x', 'bun install', 'pip install requests',
    'git clean -fd', 'git checkout -- .', 'git stash', 'npx prisma migrate reset', 'psql -c "DROP TABLE users"',
    'find . -name "*.log" -delete', "sed -i '' s/a/b/ f"];
  const fresh = () => { const x = sandbox(); x.write('f', 'x'); return x; };
  for (const cmd of risky) {
    const x = fresh();
    bash(x, cmd);
    assert.strictEqual(core.listSnapshots(x.project).length, 1, cmd);
    x.cleanup();
  }
  s.cleanup();
});

test('respects the level and only fires in project directories', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  for (const level of ['lite', 'off']) {
    spawnSync(process.execPath, [BIN('hook-pretooluse.cjs')], {
      input: JSON.stringify({ tool_name: 'Bash', cwd: s.project, tool_input: { command: 'rm -rf build' } }),
      env: { ...s.env, AGENT_UNDO_LEVEL: level },
    });
  }
  assert.strictEqual(core.listSnapshots(s.project).length, 0, 'lite/off never auto-snapshot');

  const fs = require('node:fs');
  const loose = require('node:path').join(s.tmp, 'not-a-project');
  fs.mkdirSync(loose); fs.writeFileSync(require('node:path').join(loose, 'notes.txt'), 'x');
  fire(s, { tool_name: 'Bash', cwd: loose, tool_input: { command: 'rm -rf old' } });
  assert.strictEqual(core.listSnapshots(loose).length, 0, 'no project marker → no auto-snapshot');

  bash(s, 'rm -rf build');
  assert.strictEqual(core.listSnapshots(s.project)[0].trigger, 'hook');
});

test('never blocks: bad JSON, other tools, unsafe dirs all exit 0', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  assert.strictEqual(fire(s, 'not json').status, 0);
  assert.strictEqual(fire(s, { tool_name: 'Edit', cwd: s.project, tool_input: {} }).status, 0);
  assert.strictEqual(fire(s, { tool_name: 'Bash', cwd: require('node:os').homedir(), tool_input: { command: 'rm -rf x' } }).status, 0);
});
