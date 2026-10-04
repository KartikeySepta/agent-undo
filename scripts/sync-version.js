#!/usr/bin/env node
// Runs on `npm version <x>`: copies package.json's version into every other place that declares it.
// scripts/check-versions.js (CI) fails if they ever drift. Only the version string is replaced, so
// each file keeps its formatting.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));

const targets = {
  '.claude-plugin/plugin.json': /("version"\s*:\s*)"[^"]*"/,
  '.codex-plugin/plugin.json': /("version"\s*:\s*)"[^"]*"/,
  'gemini-extension.json': /("version"\s*:\s*)"[^"]*"/,
  'src/version.ts': /(VERSION = )'[^']*'/,
};

for (const [rel, re] of Object.entries(targets)) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  if (!re.test(text)) throw new Error(`${rel}: no version field to update`);
  const quote = rel.endsWith('.ts') ? "'" : '"';
  fs.writeFileSync(file, text.replace(re, `$1${quote}${version}${quote}`));
}

console.log(`synced ${version} → ${Object.keys(targets).join(', ')}`);
