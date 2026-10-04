#!/usr/bin/env node
// Runs on `npm version <x>`: copies package.json's version into every other place that declares it.
// tests/plugin.test.js fails if they ever drift.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));

const pluginPath = path.join(root, '.claude-plugin/plugin.json');
const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
plugin.version = version;
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');

const versionTs = path.join(root, 'src/version.ts');
fs.writeFileSync(versionTs, fs.readFileSync(versionTs, 'utf8').replace(/'\d+\.\d+\.\d+[^']*'/, `'${version}'`));

console.log(`synced ${version} → plugin.json, src/version.ts`);
