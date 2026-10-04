const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { BIN, sandbox } = require('./helpers');

const cli = (s, ...args) => execFileSync(process.execPath, [BIN('agent-undo.cjs'), ...args], { cwd: s.project, env: s.env, encoding: 'utf8' });

test('revert without --yes only previews', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one');
  cli(s, 'snapshot', 'base');
  s.write('a.txt', 'two');
  assert.match(cli(s, 'revert'), /would undo 1 change/);
  assert.strictEqual(s.read('a.txt'), 'two');
  assert.match(cli(s, 'revert', '--yes'), /Undo this revert with: agent-undo revert .*pre-revert/);
  assert.strictEqual(s.read('a.txt'), 'one');
});

test('list, diff and revert --only', (t) => {
  const s = sandbox(); t.after(s.cleanup);
  s.write('a.txt', 'one'); s.write('b.txt', 'one');
  cli(s, 'snapshot', 'base');
  s.write('a.txt', 'two'); s.write('b.txt', 'two');

  assert.match(cli(s, 'list'), /-base\s+\[/);
  assert.match(cli(s, 'diff'), /~ a\.txt[\s\S]*~ b\.txt[\s\S]*0 added, 2 modified, 0 deleted/);
  cli(s, 'revert', '--only', 'a.txt');
  assert.strictEqual(s.read('a.txt'), 'one');
  assert.strictEqual(s.read('b.txt'), 'two');
});

test('--version matches package.json', () => {
  const s = sandbox();
  assert.strictEqual(cli(s, '--version').trim(), require('../package.json').version);
  s.cleanup();
});
