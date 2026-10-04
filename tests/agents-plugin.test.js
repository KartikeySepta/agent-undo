// Manifests for the non-Claude hosts: each parses, names agent-undo at the shared version, and
// every file it points at exists. Plus the guards that keep rule copies and versions in sync.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { ROOT, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

const json = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const { version } = json('package.json');
const script = (name, args = [], opts = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', name), ...args], { encoding: 'utf8', ...opts });

test('rule copies and versions are in sync (scripts/check-rule-copies.js, check-versions.js)', () => {
  for (const name of ['check-rule-copies.js', 'check-versions.js']) {
    const r = script(name);
    assert.strictEqual(r.status, 0, `${name}: ${r.stderr}`);
  }
});

test('AGENTS.md carries every core rule and the MCP tool names', () => {
  const { CORE_RULES } = require('../bin/core-rules.cjs');
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  CORE_RULES.forEach((rule, i) => assert.ok(agents.includes(`${i + 1}. ${rule}`), `rule ${i + 1}`));
  for (const tool of ['take_snapshot', 'list_snapshots', 'diff_snapshot', 'revert_environment', 'undo_status']) assert.ok(agents.includes(tool), tool);
});

test('no hooks/hooks.json: Gemini CLI auto-loads that path, and the Claude hooks use Claude event names', () => {
  assert.strictEqual(exists('hooks/hooks.json'), false);
  assert.strictEqual(json('.claude-plugin/plugin.json').hooks, './hooks/claude-hooks.json');
});

test('Codex plugin: manifest, hooks and MCP config point at committed files', () => {
  const plugin = json('.codex-plugin/plugin.json');
  assert.strictEqual(plugin.name, 'agent-undo');
  assert.strictEqual(plugin.version, version);
  assert.ok(exists(plugin.skills) && exists(plugin.hooks) && exists(plugin.mcpServers));
  assert.ok(plugin.interface.displayName);

  const hooks = json(plugin.hooks).hooks;
  assert.deepStrictEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart', 'UserPromptSubmit']);
  for (const entry of Object.values(hooks).flat()) {
    for (const h of entry.hooks) {
      const m = h.command.match(/^node "\$\{PLUGIN_ROOT\}\/(bin\/[\w-]+\.cjs)" --platform codex$/);
      assert.ok(m, h.command);
      assert.ok(exists(m[1]), m[1]);
    }
  }
  assert.match(hooks.PreToolUse[0].matcher, /(^|\|)shell(\||$)/);

  const server = json(plugin.mcpServers).mcpServers['agent-undo'];
  assert.ok(exists(path.join(server.cwd, server.args[0])));

  const market = json('.agents/plugins/marketplace.json');
  assert.strictEqual(market.plugins[0].name, plugin.name);
  assert.match(market.plugins[0].source.url, /KartikeySepta\/agent-undo/);
});

test('Cursor: rule file, MCP example and hooks template point at real files', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.cursor/rules/agent-undo.mdc'), 'utf8'), /^---\ndescription: .+\nalwaysApply: true\n---\n/);
  const mcp = json('.cursor/mcp.json').mcpServers['agent-undo'];
  assert.ok(exists(mcp.args[0].replace('${workspaceFolder}/', '')));

  const template = json('hooks/cursor-hooks.json');
  assert.strictEqual(template.version, 1);
  assert.deepStrictEqual(Object.keys(template.hooks).sort(), ['beforeSubmitPrompt', 'preToolUse', 'sessionStart']);
  for (const [, entries] of Object.entries(template.hooks)) {
    for (const e of entries) {
      const m = e.command.match(/^node "AGENT_UNDO_DIR\/(bin\/[\w-]+\.cjs)" --platform cursor$/);
      assert.ok(m, e.command);
      assert.ok(exists(m[1]), m[1]);
    }
  }
  assert.strictEqual(template.hooks.preToolUse[0].matcher, 'Shell');
});

test('Cursor installer merges into hooks.json, is idempotent, and uninstalls only its own entries', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-undo-cursor-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const file = path.join(home, '.cursor', 'hooks.json');
  const mine = { command: 'echo mine' };
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ version: 1, hooks: { sessionStart: [mine] } }));

  for (let i = 0; i < 2; i++) assert.strictEqual(script('cursor-hooks.js', ['install'], { env }).status, 0);
  const installed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(installed.hooks.sessionStart.length, 2, 'kept the user hook, added ours once');
  assert.deepStrictEqual(installed.hooks.sessionStart[0], mine);
  const ours = installed.hooks.preToolUse[0].command;
  assert.ok(ours.includes(ROOT.replace(/\\/g, '/')) && !ours.includes('AGENT_UNDO_DIR'), ours);

  assert.strictEqual(script('cursor-hooks.js', ['uninstall'], { env }).status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1, hooks: { sessionStart: [mine] } });

  fs.writeFileSync(file, '{ not json');
  const bad = script('cursor-hooks.js', ['install'], { env });
  assert.strictEqual(bad.status, 1);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json', 'malformed file left untouched');
});

test('Gemini extension: context file, MCP server and commands', () => {
  const ext = json('gemini-extension.json');
  assert.strictEqual(ext.name, 'agent-undo');
  assert.strictEqual(ext.version, version);
  assert.strictEqual(ext.contextFileName, 'AGENTS.md');
  const server = ext.mcpServers['agent-undo'];
  assert.ok(exists(server.args[0].replace('${extensionPath}${/}', '').split('${/}').join('/')));

  const commands = fs.readdirSync(path.join(ROOT, 'commands')).sort();
  assert.deepStrictEqual(commands, ['undo-checkpoint.toml', 'undo-diff.toml', 'undo-help.toml', 'undo-revert.toml']);
  for (const file of commands) {
    const toml = fs.readFileSync(path.join(ROOT, 'commands', file), 'utf8');
    assert.match(toml, /^description = "[^"\n]+"\nprompt = """\n[\s\S]+\n"""\n$/, file);
    assert.ok(exists(`skills/${file.replace('.toml', '')}/SKILL.md`), `${file} mirrors a skill`);
  }
});

test('OpenCode: config parses and the plugin injects rules and snapshots before risky bash', async (t) => {
  const config = json('opencode.json');
  assert.ok(exists(config.mcp['agent-undo'].command[1]));

  const s = sandbox(); t.after(s.cleanup); s.write('f', 'x'); // sets AGENT_UNDO_HOME, inherited by the plugin's hook children

  const plugin = (await import(pathToFileURL(path.join(ROOT, '.opencode/plugins/agent-undo.mjs')))).default;
  assert.strictEqual(plugin.id, 'agent-undo');
  assert.strictEqual(typeof plugin.setup, 'function');
  const hooks = await plugin.server({ directory: s.project });

  const output = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID: 'a' }, output);
  assert.match(output.system[0], /AGENT-UNDO ACTIVE \(full\)[\s\S]*Diff before revert/);
  assert.match(output.system[0], /being taken now/, 'first turn of a session runs SessionStart');
  // The baseline runs detached; wait for it so it neither holds the lock nor outlives the sandbox.
  const lock = path.join(core.snapshotBase(s.project), '.lock');
  const busy = () => !core.listSnapshots(s.project).length || fs.existsSync(lock);
  for (const end = Date.now() + 5000; Date.now() < end && busy();) await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(core.listSnapshots(s.project)[0].trigger, 'session');

  const later = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID: 'a' }, later);
  assert.doesNotMatch(later.system[0], /being taken now/, 'later turns only re-inject the rules');

  await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'ls' } });
  await hooks['tool.execute.before']({ tool: 'read' }, { args: { command: 'rm -rf x' } });
  await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'rm -rf build' } });
  assert.ok(core.listSnapshots(s.project).some((m) => m.reason === 'auto: rm -rf build'));

  const v2 = {};
  await plugin.setup({ location: { directory: s.project }, session: { hook: async (name, cb) => { v2[name] = cb; } } });
  const event = { sessionID: 'a', system: [] };
  v2.context(event);
  assert.strictEqual(event.system[0].type, 'text');
  assert.match(event.system[0].text, /AGENT-UNDO ACTIVE/);
});
