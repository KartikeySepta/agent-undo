#!/usr/bin/env node
// Every file that declares the project version must agree, and on a release-tag CI run the shared
// version must equal the tag (catches a release whose manifests were never bumped together).
// `npm version` keeps them in sync via scripts/sync-version.js; this is the guard.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const PINNED = /^\d+\.\d+\.\d+$/;

// Add new host manifests here (and to scripts/sync-version.js).
const JSON_FILES = [
  'package.json',               // npm package (CLI + MCP server)
  '.claude-plugin/plugin.json', // Claude Code plugin
  '.codex-plugin/plugin.json',  // Codex plugin
  'gemini-extension.json',      // Gemini CLI extension
];

function readVersion(rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, '');
  if (rel.endsWith('.json')) return JSON.parse(text).version;
  return (text.match(/VERSION = '([^']*)'/) || [])[1];
}

const versions = [...JSON_FILES, 'src/version.ts'].map((rel) => [rel, readVersion(rel)]);
let failed = false;
for (const [rel, v] of versions) {
  if (typeof v !== 'string' || !PINNED.test(v)) {
    console.error(`${rel}: version must be a pinned X.Y.Z, got ${JSON.stringify(v)}`);
    failed = true;
  }
}

const distinct = [...new Set(versions.map(([, v]) => v))];
if (distinct.length > 1) {
  console.error('Version mismatch; run `node scripts/sync-version.js` (or `npm version <x>`):');
  for (const [rel, v] of versions) console.error(`  ${v}\t${rel}`);
  failed = true;
}

if (distinct.length === 1 && process.env.GITHUB_REF_TYPE === 'tag') {
  const tag = (process.env.GITHUB_REF_NAME || '').replace(/^v/, '');
  if (PINNED.test(tag) && tag !== distinct[0]) {
    console.error(`release tag v${tag} does not match version ${distinct[0]}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`All ${versions.length} version files at ${distinct[0]}.`);
