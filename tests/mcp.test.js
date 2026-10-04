const test = require('node:test');
const assert = require('node:assert');
const { BIN, ROOT, sandbox } = require('./helpers');
const core = require('../bin/core.cjs');

async function connect(s) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN('agent-undo-mcp.cjs')], cwd: s.project, env: s.env, stderr: 'ignore' }));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  // Two-step revert: preview, then confirm with the token from the preview.
  const revert = async (args = {}) => {
    const preview = await call('revert_environment', args);
    const token = /confirm_token: (\w+)/.exec(preview)?.[1];
    return token ? call('revert_environment', { ...args, confirm: token }) : preview;
  };
  return { client, call, revert };
}

test('MCP server exposes the four tools and they work end to end', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one'); s.write('b.txt', 'one');
  const { client, call, revert } = await connect(s);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepStrictEqual(tools.map((x) => x.name).sort(), ['diff_snapshot', 'list_snapshots', 'revert_environment', 'take_snapshot', 'undo_status']);

  assert.match(await call('take_snapshot', { name: 'base' }), /Snapshot .*-base taken/);
  s.write('a.txt', 'two'); s.write('b.txt', 'two');
  assert.match(await call('diff_snapshot'), /0 added, 2 modified, 0 deleted/);
  assert.match(await revert({ paths: ['a.txt'] }), /\(only a\.txt\).*pre-revert/);
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.strictEqual(s.read('b.txt'), 'two');
  assert.match(await call('list_snapshots'), /-base \[manual, /);
  assert.match(await call('undo_status'), /"snapshots": 2[\s\S]*same volume/);
  assert.match(await call('revert_environment', { snapshot: 'nope' }), /No snapshot matches/);
});

test('refuses to default to its own install directory (Codex/Gemini start it there)', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN('agent-undo-mcp.cjs')], cwd: ROOT, env: s.env, stderr: 'ignore' }));
  t.after(() => client.close());
  const r = await client.callTool({ name: 'take_snapshot', arguments: {} });
  assert.strictEqual(r.isError, true);
  assert.match(r.content[0].text, /own install directory[\s\S]*project_dir/);
  assert.strictEqual(core.listSnapshots(ROOT).length, 0, 'nothing snapshotted');
  s.write('y.txt', 'v');
  const ok = await client.callTool({ name: 'take_snapshot', arguments: { project_dir: s.project } });
  assert.match(ok.content[0].text, /Snapshot .* taken/);
});

test('project_dir targets a project other than the server cwd', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  const other = sandbox(); t.after(other.cleanup);
  other.write('x.txt', 'orig');
  process.env.AGENT_UNDO_HOME = s.home; // both use the first store
  const { client, call, revert } = await connect(s);
  t.after(() => client.close());
  await call('take_snapshot', { project_dir: other.project });
  other.write('x.txt', 'broken');
  await revert({ project_dir: other.project });
  assert.strictEqual(other.read('x.txt'), 'orig');
});

test('revert_environment is two-step: preview changes nothing, a stale or wrong token is rejected', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one'); s.write('b.txt', 'one');
  const { client, call } = await connect(s);
  t.after(() => client.close());
  await call('take_snapshot', { name: 'base' });
  s.write('a.txt', 'two'); s.write('c.txt', 'new');

  const preview = await call('revert_environment', { snapshot: 'base' });
  assert.match(preview, /PREVIEW ONLY: nothing was reverted/);
  assert.match(preview, /\+ c\.txt[\s\S]*~ a\.txt/);
  assert.match(preview, /1 added .*1 modified, 0 deleted/);
  const token = /confirm_token: (\w+)/.exec(preview)[1];
  assert.strictEqual(s.read('a.txt'), 'two', 'preview must not touch files');
  assert.ok(s.exists('c.txt'));
  assert.strictEqual(core.listSnapshots(s.project).length, 1, 'preview takes no pre-revert backup');
  assert.strictEqual(await call('revert_environment', { snapshot: 'base' }), preview, 'token is deterministic');

  assert.match(await call('revert_environment', { snapshot: 'base', confirm: 'deadbeef0000' }), /does not match[\s\S]*Nothing was reverted/);
  assert.strictEqual(s.read('a.txt'), 'two');

  s.write('b.txt', 'changed after preview'); // tree moved: the old token is stale
  const stale = await call('revert_environment', { snapshot: 'base', confirm: token });
  assert.match(stale, /does not match[\s\S]*~ b\.txt/);
  assert.strictEqual(s.read('a.txt'), 'two');

  const fresh = /confirm_token: (\w+)/.exec(stale)[1];
  assert.notStrictEqual(fresh, token);
  assert.match(await call('revert_environment', { snapshot: 'base', confirm: fresh }), /Reverted to .*-base\. To undo/);
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.strictEqual(s.read('b.txt'), 'one');
  assert.ok(!s.exists('c.txt'));
});

test('partial revert preview is scoped to paths and its token does not confirm a full revert', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('src/a.js', 'good'); s.write('src/b.js', 'good'); s.write('keep.txt', 'v1');
  const { client, call } = await connect(s);
  t.after(() => client.close());
  await call('take_snapshot', { name: 'base' });
  s.write('src/a.js', 'broken'); s.write('src/b.js', 'broken'); s.write('keep.txt', 'v2');

  const preview = await call('revert_environment', { paths: ['./src/'] });
  assert.match(preview, /only src/);
  assert.match(preview, /~ src\/a\.js[\s\S]*~ src\/b\.js/);
  assert.doesNotMatch(preview, /keep\.txt/);
  const token = /confirm_token: (\w+)/.exec(preview)[1];

  assert.match(await call('revert_environment', { confirm: token }), /does not match/, 'scope is part of the token');
  assert.strictEqual(s.read('keep.txt'), 'v2');

  assert.match(await call('revert_environment', { paths: ['src'], confirm: token }), /\(only src\)/, 'equivalent path spelling confirms');
  assert.strictEqual(s.read('src/a.js'), 'good');
  assert.strictEqual(s.read('src/b.js'), 'good');
  assert.strictEqual(s.read('keep.txt'), 'v2');
});

test('paranoid level: the preview tells the agent not to confirm on its own', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  s.env.AGENT_UNDO_LEVEL = 'paranoid';
  const { client, call } = await connect(s);
  t.after(() => client.close());
  await call('take_snapshot');
  s.write('a.txt', 'two');
  assert.match(await call('revert_environment'), /PARANOID: do not confirm yourself/);
});
