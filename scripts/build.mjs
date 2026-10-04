// Bundle into committed bin/ files so the plugin runs with zero `npm install`.
// koffi stays external: it ships native binaries and is optional (falls back to cp -c).
import { build } from 'esbuild';

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
