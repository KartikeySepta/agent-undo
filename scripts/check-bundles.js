#!/usr/bin/env node
// bin/ is committed so the plugin works without `npm install`. Fail if it is stale vs src/.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
try {
  execFileSync('git', ['diff', '--exit-code', '--stat', '--', 'bin/'], { cwd: root, stdio: 'inherit' });
  console.log('bin/ is up to date');
} catch {
  console.error('bin/ is stale: run `npm run build` and commit the result.');
  process.exit(1);
}
