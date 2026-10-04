#!/usr/bin/env node
// bin/ (and the rule files generated with it) are committed so the plugin works without
// `npm install`. Fail if they are stale vs src/.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const paths = ['bin/', 'AGENTS.md', '.cursor/rules/'];
try {
  execFileSync('git', ['diff', '--exit-code', '--stat', '--', ...paths], { cwd: root, stdio: 'inherit' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], { cwd: root, encoding: 'utf8' }).trim();
  if (untracked) throw new Error(`untracked: ${untracked}`);
  console.log('bin/ and generated rule files are up to date');
} catch (e) {
  if (e.message.startsWith('untracked')) console.error(e.message);
  console.error('bin/ or a generated rule file is stale: run `npm run build` and commit the result.');
  process.exit(1);
}
