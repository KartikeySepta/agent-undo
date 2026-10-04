// Manifest and packaging integrity: what `/plugin install` will actually load.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers');

const json = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const pkg = json('package.json');
const plugin = json('.claude-plugin/plugin.json');
const pluginPath = (cmd) => cmd.replace('${CLAUDE_PLUGIN_ROOT}', ROOT).replace(/^node\s+"?|"$/g, '').replace(/"$/, '');

test('plugin manifest is valid and versions agree', () => {
  assert.match(plugin.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  assert.strictEqual(plugin.version, pkg.version);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/version.ts'), 'utf8'), new RegExp(`'${pkg.version.replace(/\./g, '\\.')}'`));
  const market = json('.claude-plugin/marketplace.json');
  assert.strictEqual(market.plugins[0].name, plugin.name);
  assert.strictEqual(market.plugins[0].source, './');
});

test('every hook and the MCP server point at a committed bundle', () => {
  const hooks = json(plugin.hooks).hooks;
  const commands = Object.values(hooks).flat().flatMap((h) => h.hooks.map((x) => x.command));
  assert.ok(commands.length >= 4);
  for (const cmd of commands) assert.ok(fs.existsSync(pluginPath(cmd)), cmd);
  for (const server of Object.values(plugin.mcpServers)) {
    assert.ok(fs.existsSync(server.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)), server.args[0]);
  }
  for (const bin of Object.values(pkg.bin)) assert.ok(fs.existsSync(path.join(ROOT, bin)), bin);
});

test('every skill has frontmatter whose name matches its directory', () => {
  const dirs = fs.readdirSync(path.join(ROOT, 'skills'));
  assert.deepStrictEqual(dirs.sort(), ['agent-undo', 'undo-checkpoint', 'undo-diff', 'undo-gain', 'undo-help', 'undo-revert']);
  for (const dir of dirs) {
    const text = fs.readFileSync(path.join(ROOT, 'skills', dir, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `${dir}: frontmatter`);
    assert.match(fm[1], new RegExp(`^name: ${dir}$`, 'm'), `${dir}: name`);
    assert.match(fm[1], /^description: /m, `${dir}: description`);
  }
});

test('the main skill carries the exact injected rules (no drift)', () => {
  const { CORE_RULES } = require('../bin/core-rules.cjs');
  const skill = fs.readFileSync(path.join(ROOT, 'skills/agent-undo/SKILL.md'), 'utf8');
  CORE_RULES.forEach((rule, i) => assert.ok(skill.includes(`${i + 1}. ${rule}`), `rule ${i + 1} missing or changed in SKILL.md`));
});

test('help card lists every skill', () => {
  const help = fs.readFileSync(path.join(ROOT, 'skills/undo-help/SKILL.md'), 'utf8');
  for (const dir of fs.readdirSync(path.join(ROOT, 'skills'))) assert.ok(help.includes(`/${dir}`), dir);
});
