const test = require('node:test');
const assert = require('node:assert');
const { BIN, sandbox } = require('./helpers');

async function connect(s) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN('agent-undo-mcp.cjs')], cwd: s.project, env: s.env, stderr: 'ignore' }));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  return { client, call };
}

test('MCP server exposes the four tools and they work end to end', async (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one'); s.write('b.txt', 'one');
  const { client, call } = await connect(s);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepStrictEqual(tools.map((x) => x.name).sort(), ['diff_snapshot', 'list_snapshots', 'revert_environment', 'take_snapshot']);

  assert.match(await call('take_snapshot', { name: 'base' }), /Snapshot .*-base taken/);
  s.write('a.txt', 'two'); s.write('b.txt', 'two');
  assert.match(await call('diff_snapshot'), /0 added, 2 modified, 0 deleted/);
  assert.match(await call('revert_environment', { paths: ['a.txt'] }), /\(only a\.txt\).*pre-revert/);
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.strictEqual(s.read('b.txt'), 'two');
  assert.match(await call('list_snapshots'), /-base \[/);
  assert.match(await call('revert_environment', { snapshot: 'nope' }), /No snapshot matches/);
});
