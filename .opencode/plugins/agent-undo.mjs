// agent-undo — OpenCode plugin.
//
// Reuses the committed hook bundles (bin/hook-*.cjs) so OpenCode gets the same behavior as Claude
// Code from the same code:
//   - the ruleset for the active level is added to the system prompt every turn, and the first
//     turn of a session takes the background baseline snapshot (SessionStart equivalent);
//   - risky `bash` commands are snapshotted before they run (PreToolUse equivalent).
// The bundles are fed Claude-shaped JSON and answer in Claude's shape, which is parsed here.
//
// One default export serves both plugin APIs: OpenCode 1 calls `server()`, OpenCode 2 reads
// `id` + `setup` (rules only: no shell hook there yet).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin');

/** Run one hook bundle with a Claude-style payload; returns its additionalContext ('' on any failure). */
function hook(name, payload) {
  try {
    const r = spawnSync(process.execPath, [path.join(BIN, name)], {
      input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000,
    });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
  } catch {
    return '';
  }
}

// Sessions that already got their SessionStart treatment in this process.
const started = new Set();

function rules(sessionID, directory) {
  if (started.has(sessionID)) return hook('hook-subagent-start.cjs', {});
  started.add(sessionID);
  return hook('hook-session-start.cjs', { source: 'startup', cwd: directory });
}

export default {
  id: 'agent-undo',

  // OpenCode 1.
  async server(ctx = {}) {
    const directory = ctx.directory || process.cwd();
    return {
      'experimental.chat.system.transform': async (input, output) => {
        const text = rules(input?.sessionID ?? 'default', directory);
        if (text) output.system.push(text);
      },
      'tool.execute.before': async (input, output) => {
        if (input?.tool !== 'bash' || typeof output?.args?.command !== 'string') return;
        hook('hook-pretooluse.cjs', { tool_name: 'Bash', cwd: directory, tool_input: { command: output.args.command } });
      },
    };
  },

  // OpenCode 2.
  async setup(ctx) {
    // V2 splits V1's {worktree, directory} into location.directory and location.project.directory.
    const directory = ctx.location?.directory || ctx.location?.project?.directory || process.cwd();
    await ctx.session.hook('context', (event) => {
      const text = rules(event?.sessionID ?? 'default', directory);
      if (text) event.system.push({ type: 'text', text });
    });
  },
};
