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

test('asks before commands a snapshot cannot undo (Claude Code decision shape)', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  const irreversible = [
    'git push --force origin main', 'git push -f', 'git push origin +main', 'git push --force-with-lease origin feat',
    'terraform apply -auto-approve', 'terraform destroy', 'kubectl delete ns staging', 'kubectl apply -f k8s/',
    'vercel deploy --prod', 'netlify deploy --dir=dist --prod', 'fly deploy', 'flyctl deploy', 'heroku pg:reset DATABASE_URL',
    'psql postgres://admin@db.prod.internal:5432/app -c "DROP DATABASE app"',
    'DATABASE_URL=mysql://u:p@10.0.0.5/shop npx prisma migrate reset --force',
    './scripts/prod-db.sh reset --seed', 'npm run deploy:prod', 'make deploy ENV=production', 'node migrate.js --env=prod',
  ];
  const safe = [
    'git push', 'git push origin main', 'git push -u origin feature', 'git status', 'npm run deploy:staging', 'terraform plan',
    'kubectl get pods', 'vercel deploy', 'heroku logs --tail', 'npm run build:production', 'ls products/',
    'psql postgres://localhost:5432/app -c "DROP DATABASE app"', 'psql postgresql://127.0.0.1/app -c "TRUNCATE t"',
    'node scripts/product-migrate.js', 'cat prod.env',
  ];
  for (const cmd of irreversible) {
    const out = JSON.parse(bash(s, cmd).stdout || '{}');
    assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'ask', cmd);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse', cmd);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /cannot roll this back: it acts outside the project/, cmd);
  }
  for (const cmd of safe) assert.strictEqual(bash(s, cmd).stdout, '', cmd);
});

test('the irreversible guard keeps the risky snapshot, honours the level, and is Claude-only', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  assert.match(bash(s, 'psql postgres://db.example.com/app -c "DROP DATABASE app"').stdout, /"permissionDecision":"ask"/);
  assert.strictEqual(core.listSnapshots(s.project).length, 1, 'still snapshots the risky command');

  const run = (env, args = []) => spawnSync(process.execPath, [BIN('hook-pretooluse.cjs'), ...args], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: s.project, tool_input: { command: 'terraform destroy' } }), env: { ...s.env, ...env }, encoding: 'utf8',
  }).stdout;
  assert.strictEqual(run({ AGENT_UNDO_LEVEL: 'lite' }), '', 'lite: no guard');
  assert.strictEqual(run({ AGENT_UNDO_LEVEL: 'off' }), '', 'off: no guard');
  assert.match(run({ AGENT_UNDO_LEVEL: 'paranoid' }), /"ask"/);
  for (const p of ['codex', 'cursor', 'gemini']) assert.doesNotMatch(run({}, ['--platform', p]), /permissionDecision|"ask"/, p);
});

test('a hook that fails still exits 0, and the failure is logged and shown by doctor', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  const fs = require('node:fs');
  const path = require('node:path');
  // Make the snapshot store unusable (a file where the snapshots dir should be) while the log dir stays writable.
  fs.mkdirSync(s.home, { recursive: true });
  fs.writeFileSync(path.join(s.home, 'snapshots'), 'not a directory');

  const r = bash(s, 'rm -rf build');
  assert.strictEqual(r.status, 0, 'a failing hook must never block the agent');
  const log = fs.readFileSync(path.join(s.home, 'hooks.log'), 'utf8');
  assert.match(log, /^\S+ PreToolUse .+/m);

  const doctor = spawnSync(process.execPath, [BIN('agent-undo.cjs'), 'doctor'], { cwd: s.project, env: s.env, encoding: 'utf8' });
  assert.match(doctor.stdout, /hooks.*last failure: .*PreToolUse/);
});
