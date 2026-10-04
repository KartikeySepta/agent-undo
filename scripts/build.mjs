// Bundle into committed bin/ files so the plugin runs with zero `npm install`.
// koffi stays external: it ships native binaries and is optional (falls back to cp -c).
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const entries = {
  'agent-undo': 'src/cli.ts',
  'agent-undo-mcp': 'src/mcp-server.ts',
  'hook-pretooluse': 'src/hooks/pretooluse.ts',
  'hook-session-start': 'src/hooks/session-start.ts',
  'hook-prompt': 'src/hooks/prompt.ts',
  'hook-subagent-start': 'src/hooks/subagent-start.ts',
  statusline: 'src/statusline.ts',
  core: 'src/snapshot.ts',
  'core-rules': 'src/instructions.ts',
};

await build({
  entryPoints: entries,
  outdir: 'bin',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['koffi'],
  logLevel: 'warning',
});
console.log(`built ${Object.keys(entries).length} bundles into bin/`);

// Static rule files for hosts without hooks, generated from src/instructions.ts so they cannot drift.
const { getAgentsMd, getCursorRule } = createRequire(import.meta.url)('../bin/core-rules.cjs');
const generated = { 'AGENTS.md': getAgentsMd(), '.cursor/rules/agent-undo.mdc': getCursorRule() };
for (const [file, text] of Object.entries(generated)) {
  const url = new URL(`../${file}`, import.meta.url);
  fs.mkdirSync(new URL('.', url), { recursive: true });
  fs.writeFileSync(url, text);
}
console.log(`wrote ${Object.keys(generated).join(', ')}`);
