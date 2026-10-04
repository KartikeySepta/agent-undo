const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const run = (s, bin, payload, env = {}) => {
  const r = spawnSync(process.execPath, [BIN(bin)], { input: JSON.stringify(payload), env: { ...s.env, ...env }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
};
const waitFor = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (fn()) return true;
  return false;
};

test('SessionStart injects the ruleset and takes a background baseline', async (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('a.txt', 'x');
  const out = run(s, 'hook-session-start.cjs', { hook_event_name: 'SessionStart', source: 'startup', cwd: s.project });
  assert.strictEqual(out.hookEventName, 'SessionStart');
  assert.match(out.additionalContext, /AGENT-UNDO ACTIVE \(full\)/);
  assert.match(out.additionalContext, /Revert in two steps/);
  assert.match(out.additionalContext, /baseline snapshot .* being taken/);
  assert.ok(await waitFor(() => core.listSnapshots(s.project).length === 1), 'baseline appears');
  assert.strictEqual(core.listSnapshots(s.project)[0].trigger, 'session');
});

test('SessionStart: no baseline on resume/compact, in lite, or outside a project; nothing when off', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  run(s, 'hook-session-start.cjs', { source: 'resume', cwd: s.project });
  run(s, 'hook-session-start.cjs', { source: 'compact', cwd: s.project });
  const lite = run(s, 'hook-session-start.cjs', { source: 'startup', cwd: s.project }, { AGENT_UNDO_LEVEL: 'lite' });
  assert.match(lite.additionalContext, /Level LITE/);

  const loose = path.join(s.tmp, 'loose'); fs.mkdirSync(loose);
  const outside = run(s, 'hook-session-start.cjs', { source: 'startup', cwd: loose });
  assert.match(outside.additionalContext, /Not a project directory/);

  assert.strictEqual(run(s, 'hook-session-start.cjs', { source: 'startup', cwd: s.project }, { AGENT_UNDO_LEVEL: 'off' }), null);
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(core.listSnapshots(s.project).length, 0);
});

test('UserPromptSubmit switches levels and persists them', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const out = run(s, 'hook-prompt.cjs', { prompt: '/agent-undo paranoid', cwd: s.project });
  assert.match(out.additionalContext, /level is now PARANOID/);
  assert.strictEqual(fs.readFileSync(path.join(s.home, 'level'), 'utf8').trim(), 'paranoid');

  run(s, 'hook-prompt.cjs', { prompt: '/agent-undo:agent-undo lite', cwd: s.project });
  assert.strictEqual(execFileSync(process.execPath, [BIN('agent-undo.cjs'), 'mode'], { env: s.env, encoding: 'utf8' }).trim(), 'lite');

  run(s, 'hook-prompt.cjs', { prompt: 'stop undo', cwd: s.project });
  assert.strictEqual(fs.readFileSync(path.join(s.home, 'level'), 'utf8').trim(), 'off');

  assert.strictEqual(run(s, 'hook-prompt.cjs', { prompt: '/agent-undo banana', cwd: s.project }), null, 'unknown level ignored');
  assert.strictEqual(run(s, 'hook-prompt.cjs', { prompt: 'please undo the last change', cwd: s.project }), null, 'ordinary prompts are silent');
});

test('paranoid: a checkpoint per turn (throttled), none in full', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  run(s, 'hook-prompt.cjs', { prompt: 'refactor the api', cwd: s.project });
  assert.strictEqual(core.listSnapshots(s.project).length, 0, 'full: no per-turn checkpoints');

  run(s, 'hook-prompt.cjs', { prompt: 'refactor the api', cwd: s.project }, { AGENT_UNDO_LEVEL: 'paranoid' });
  run(s, 'hook-prompt.cjs', { prompt: 'and the tests', cwd: s.project }, { AGENT_UNDO_LEVEL: 'paranoid' });
  const snaps = core.listSnapshots(s.project);
  assert.strictEqual(snaps.length, 1, 'second turn within 15s is throttled');
  assert.strictEqual(snaps[0].trigger, 'turn');
  assert.match(snaps[0].reason, /^turn: refactor the api/);
});

test('SubagentStart passes the rules to subagents', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  assert.match(run(s, 'hook-subagent-start.cjs', {}).additionalContext, /AGENT-UNDO ACTIVE \(full\)/);
  assert.strictEqual(run(s, 'hook-subagent-start.cjs', {}, { AGENT_UNDO_LEVEL: 'off' }), null);
});

test('statusline shows level, count and age', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const line = (env = {}) => spawnSync(process.execPath, [BIN('statusline.cjs')], {
    input: JSON.stringify({ workspace: { current_dir: s.project } }), env: { ...s.env, ...env }, encoding: 'utf8',
  }).stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.strictEqual(line(), '⏪ undo · no snaps');
  core.takeSnapshot(s.project);
  assert.match(line(), /^⏪ undo · 1 snap · \d+s$/);
  assert.match(line({ AGENT_UNDO_LEVEL: 'paranoid' }), /^⏪ undo:paranoid/);
  assert.strictEqual(line({ AGENT_UNDO_LEVEL: 'off' }), '');
});
