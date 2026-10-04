#!/usr/bin/env node
// Snapshot/revert wall-clock per clone engine on a synthetic node_modules-shaped tree.
// Usage: node benchmarks/clone.mjs [files=50000]   (writes nothing outside the OS temp dir)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/agent-undo.cjs');
const FILES = Number(process.argv[2] ?? 50_000);
const PER_DIR = 20;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-undo-bench-')));
const project = path.join(tmp, 'project');
const fakeBin = path.join(tmp, 'fakebin');
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, 'cp'), '#!/bin/sh\nfor a in "$@"; do case "$a" in -c|--reflink=*) exit 1;; esac; done\nexec /bin/cp "$@"\n', { mode: 0o755 });

process.stdout.write(`building ${FILES.toLocaleString()} files... `);
const body = 'module.exports = ' + JSON.stringify('x'.repeat(2000)) + ';\n';
for (let i = 0; i < FILES; i++) {
  const dir = path.join(project, 'node_modules', `pkg${Math.floor(i / PER_DIR / 50)}`, `sub${Math.floor(i / PER_DIR) % 50}`);
  if (i % PER_DIR === 0) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `f${i}.js`), body);
}
fs.writeFileSync(path.join(project, 'package.json'), '{}');
const mb = (FILES * body.length) / 1e6;
console.log(`${mb.toFixed(0)} MB`);

const engines = [
  { name: 'clonefile (koffi)', env: {}, only: 'darwin' },
  { name: 'cp -c / --reflink', env: { AGENT_UNDO_NO_FFI: '1' } },
  { name: 'full copy', env: { AGENT_UNDO_NO_FFI: '1', PATH: `${fakeBin}:${process.env.PATH}`, AGENT_UNDO_MAX_COPY_MB: '100000' } },
];

const time = (args, env) => {
  const t = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [CLI, ...args], { cwd: project, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, out };
};
const freeKB = () => Number(execFileSync('df', ['-k', tmp], { encoding: 'utf8' }).trim().split('\n').pop().split(/\s+/)[3]);

const rows = [];
for (const e of engines) {
  if (e.only && e.only !== process.platform) continue;
  const env = { ...e.env, AGENT_UNDO_HOME: path.join(tmp, `store-${rows.length}`), AGENT_UNDO_SYNC_DELETE: '1' };
  const before = freeKB();
  const snap = time(['snapshot', 'base'], env);
  const usedMB = (before - freeKB()) / 1024;
  const mode = snap.out.match(/\(([^,]+),/)?.[1] ?? '?';
  fs.rmSync(path.join(project, 'node_modules', 'pkg0'), { recursive: true });
  const revert = time(['revert', 'base', '--yes'], env);
  if (!fs.existsSync(path.join(project, 'node_modules', 'pkg0'))) throw new Error('revert did not restore');
  rows.push({ engine: e.name, mode, snapshot: Math.round(snap.ms), revert: Math.round(revert.ms), disk: usedMB });
  console.log(`${e.name.padEnd(18)} snapshot ${String(Math.round(snap.ms)).padStart(6)}ms  revert ${String(Math.round(revert.ms)).padStart(6)}ms  disk ~${usedMB.toFixed(0)} MB  [${mode}]`);
}
fs.rmSync(tmp, { recursive: true, force: true });

const date = new Date().toISOString().slice(0, 10);
const md = [
  `# Clone engine benchmark: ${date}`,
  '',
  `${FILES.toLocaleString()} files, ${mb.toFixed(0)} MB, ${os.platform()} ${os.arch()}, ${os.cpus()[0].model}, Node ${process.versions.node}.`,
  'Wall-clock of the CLI (includes Node startup). Disk is the free-space delta after the snapshot (approximate).',
  'Revert includes the pre-revert backup.',
  '',
  '| Engine | Snapshot | Revert | Disk used |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.engine} | ${r.snapshot} ms | ${r.revert} ms | ~${r.disk.toFixed(0)} MB |`),
  '',
  `Reproduce: \`node benchmarks/clone.mjs ${FILES}\``,
  '',
].join('\n');
const out = path.join(ROOT, 'benchmarks/results', `${date}-clone-${os.platform()}.md`);
fs.writeFileSync(out, md);
console.log(`\nwrote ${path.relative(ROOT, out)}`);
