// The same hook bundles serve Claude Code, Codex, Cursor and Gemini CLI. Each host gets its own
// output shape (selected by `--platform <name>` from that host's hook config, or by the env vars
// the host sets), and each host names its shell tool and project dir differently.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const hook = (s, bin, payload, { args = [], env = {} } = {}) => {
  const r = spawnSync(process.execPath, [BIN(bin), ...args], { input: JSON.stringify(payload), env: { ...s.env, ...env }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
};
const json = (out) => JSON.parse(out);

test('Claude Code output is unchanged: hookSpecificOutput, silence when nothing to add', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const out = json(hook(s, 'hook-session-start.cjs', { source: 'resume', cwd: s.project }));
  assert.deepStrictEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /Project directory:/, 'Claude runs the MCP server in the project already');
  assert.strictEqual(hook(s, 'hook-prompt.cjs', { prompt: 'hello', cwd: s.project }), '');
  assert.strictEqual(hook(s, 'hook-pretooluse.cjs', { tool_name: 'Bash', cwd: s.project, tool_input: { command: 'ls' } }), '');
});

test('Codex: hookSpecificOutput context, a JSON object even when silent, project dir named', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const codex = { args: ['--platform', 'codex'] };
  const start = json(hook(s, 'hook-session-start.cjs', { source: 'resume', cwd: s.project }, codex));
  assert.strictEqual(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(start.hookSpecificOutput.additionalContext, /AGENT-UNDO ACTIVE \(full\)/);
  assert.ok(start.hookSpecificOutput.additionalContext.includes(`Project directory: ${s.project}`));
  assert.strictEqual(start.systemMessage, undefined, 'Codex renders systemMessage as a warning');

  assert.deepStrictEqual(json(hook(s, 'hook-prompt.cjs', { prompt: 'hello', cwd: s.project }, codex)), {});
  assert.match(json(hook(s, 'hook-prompt.cjs', { prompt: '$agent-undo lite', cwd: s.project }, codex)).hookSpecificOutput.additionalContext, /now LITE/);
  assert.deepStrictEqual(
    json(hook(s, 'hook-pretooluse.cjs', { tool_name: 'shell', cwd: s.project, tool_input: { command: ['bash', '-lc', 'ls'] } }, codex)),
    { hookSpecificOutput: { hookEventName: 'PreToolUse' } });
});

test('Codex: shell argv arrays and exec_command `cmd` are recognised as risky commands', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  hook(s, 'hook-pretooluse.cjs', { tool_name: 'shell', cwd: s.project, tool_input: { command: ['bash', '-lc', 'rm -rf build'] } }, { args: ['--platform', 'codex'] });
  assert.strictEqual(core.listSnapshots(s.project).length, 1);
  const o = sandbox(); t.after(o.cleanup); o.write('f', 'x');
  hook(o, 'hook-pretooluse.cjs', { tool_name: 'exec_command', cwd: o.project, tool_input: { cmd: 'npm install zod' } }, { args: ['--platform', 'codex'] });
  assert.match(core.listSnapshots(o.project)[0].reason, /^auto: npm install zod/);
});

test('Codex is also detected from PLUGIN_DATA when no --platform is passed', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  assert.deepStrictEqual(json(hook(s, 'hook-prompt.cjs', { prompt: 'hello', cwd: s.project }, { env: { PLUGIN_DATA: s.tmp } })), {});
});

test('Cursor: additional_context, continue on beforeSubmitPrompt, no-op preToolUse payload', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const cursor = { args: ['--platform', 'cursor'] };
  const start = json(hook(s, 'hook-session-start.cjs', { workspace_roots: [s.project], source: 'resume' }, cursor));
  assert.deepStrictEqual(Object.keys(start), ['additional_context']);
  assert.ok(start.additional_context.includes(`Project directory: ${s.project}`), 'project from workspace_roots');

  const sw = json(hook(s, 'hook-prompt.cjs', { prompt: '/agent-undo paranoid', workspace_roots: [s.project] }, cursor));
  assert.strictEqual(sw.continue, true);
  assert.match(sw.additional_context, /now PARANOID/);
  assert.strictEqual(hook(s, 'hook-prompt.cjs', { prompt: 'hello', workspace_roots: [s.project] }, cursor), '', 'ordinary prompts print nothing');

  const pre = json(hook(s, 'hook-pretooluse.cjs', { tool_name: 'Shell', workspace_roots: [s.project], tool_input: { command: 'ls' } }, cursor));
  assert.deepStrictEqual(pre, { agent_message: '' });
  assert.strictEqual(pre.permission, undefined, 'never overrides Cursor approval');
});

test('Cursor: Shell tool snapshots risky commands; detected from CURSOR_VERSION + CURSOR_PROJECT_DIR', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  const out = hook(s, 'hook-pretooluse.cjs', { tool_name: 'Shell', tool_input: { command: 'git reset --hard' } },
    { env: { CURSOR_VERSION: '3.20.17', CURSOR_PROJECT_DIR: s.project } });
  assert.deepStrictEqual(json(out), { agent_message: '' });
  assert.strictEqual(core.listSnapshots(s.project)[0].trigger, 'hook');
});

test('Gemini: hookSpecificOutput context, run_shell_command recognised, silent passthrough', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  const gemini = { args: ['--platform', 'gemini'] };
  const start = json(hook(s, 'hook-session-start.cjs', { source: 'resume', cwd: s.project }, gemini));
  assert.strictEqual(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(start.hookSpecificOutput.additionalContext.includes('Project directory:'));
  assert.strictEqual(hook(s, 'hook-pretooluse.cjs', { tool_name: 'run_shell_command', tool_input: { command: 'rm -rf dist' } },
    { ...gemini, env: { GEMINI_PROJECT_DIR: s.project } }), '');
  assert.strictEqual(core.listSnapshots(s.project).length, 1);
});

test('non-shell tools never snapshot on any platform', (t) => {
  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x');
  for (const platform of ['claude', 'codex', 'cursor', 'gemini']) {
    hook(s, 'hook-pretooluse.cjs', { tool_name: 'Edit', cwd: s.project, tool_input: { command: 'rm -rf x' } }, { args: ['--platform', platform] });
  }
  assert.strictEqual(core.listSnapshots(s.project).length, 0);
});
