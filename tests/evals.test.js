// Behavioral-eval fixtures must not rot: every scenario sets up, seeds its snapshots, springs its
// trap (sanity steps) and scores an empty transcript without errors. No claude calls.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { ROOT } = require('./helpers');

test('evals: every scenario fixture validates', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'evals', 'run.mjs'), 'validate'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /ok - \d+ scenarios valid/);
});
