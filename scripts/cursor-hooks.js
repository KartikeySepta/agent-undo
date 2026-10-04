#!/usr/bin/env node
// Install or remove agent-undo's Cursor hooks (hooks/cursor-hooks.json) in ~/.cursor/hooks.json
// (default) or <cwd>/.cursor/hooks.json (--project), merging with the hooks already there. Only
// entries that run one of agent-undo's bin/hook-*.cjs bundles are added or removed.
//
//   node scripts/cursor-hooks.js install [--project]
//   node scripts/cursor-hooks.js uninstall [--project]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'hooks', 'cursor-hooks.json');
const OURS = /bin\/hook-[\w-]+\.cjs" --platform cursor/;

const isOurs = (entry) => Boolean(entry && typeof entry.command === 'string' && OURS.test(entry.command));

const hooksPath = (scope) => path.join(scope === 'project' ? process.cwd() : os.homedir(), '.cursor', 'hooks.json');

// Missing file → empty config. Malformed JSON throws, so the caller refuses to overwrite it.
function readConfig(file) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) config.hooks = {};
  return config;
}

function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

// The template's AGENT_UNDO_DIR placeholder becomes this checkout's absolute path (forward slashes
// work in cmd, PowerShell and sh). A path that would need shell quoting is refused.
function ourEntries() {
  const root = ROOT.replace(/\\/g, '/');
  if (!/^[\w ./:@+~-]+$/.test(root)) {
    throw new Error(`agent-undo is at a path with shell metacharacters (${ROOT}); move it, or copy hooks/cursor-hooks.json by hand`);
  }
  const { hooks } = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  return Object.fromEntries(Object.entries(hooks).map(([event, entries]) =>
    [event, entries.map((e) => ({ ...e, command: e.command.replace(/AGENT_UNDO_DIR/g, root) }))]));
}

function strip(config) {
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((e) => !isOurs(e));
    if (kept.length) config.hooks[event] = kept;
    else delete config.hooks[event];
  }
}

function install(scope) {
  const file = hooksPath(scope);
  const config = readConfig(file);
  if (config.version === undefined) config.version = 1;
  strip(config); // re-running replaces our entries instead of duplicating them
  for (const [event, entries] of Object.entries(ourEntries())) config.hooks[event] = [...(config.hooks[event] || []), ...entries];
  writeConfig(file, config);
  return file;
}

/** Returns the file it changed, or null when nothing of ours was there. */
function uninstall(scope) {
  const file = hooksPath(scope);
  if (!fs.existsSync(file)) return null;
  const config = readConfig(file);
  const before = JSON.stringify(config);
  strip(config);
  if (JSON.stringify(config) === before) return null;
  const others = Object.keys(config).filter((k) => k !== 'version' && k !== 'hooks');
  if (!Object.keys(config.hooks).length && !others.length) fs.unlinkSync(file);
  else writeConfig(file, config);
  return file;
}

if (require.main === module) {
  const [action, ...rest] = process.argv.slice(2);
  const scope = rest.includes('--project') ? 'project' : 'user';
  try {
    if (action === 'install') {
      console.log(`Installed agent-undo hooks in ${install(scope)}`);
      console.log('Cursor reloads hooks.json on save; start a new chat to activate.');
    } else if (action === 'uninstall') {
      const file = uninstall(scope);
      console.log(file ? `Removed agent-undo hooks from ${file}` : `No agent-undo hooks in ${hooksPath(scope)}`);
    } else {
      console.error('usage: node scripts/cursor-hooks.js install|uninstall [--project]');
      process.exit(1);
    }
  } catch (e) {
    console.error(e instanceof SyntaxError ? `${hooksPath(scope)} is not valid JSON; nothing was changed (${e.message})` : e.message);
    process.exit(1);
  }
}

module.exports = { hooksPath, install, uninstall, isOurs };
