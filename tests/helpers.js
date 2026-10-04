const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BIN = (name) => path.join(ROOT, 'bin', name);
const HOST_VARS = ['CLAUDE_PROJECT_DIR', 'PLUGIN_DATA', 'CURSOR_VERSION', 'CURSOR_PROJECT_DIR', 'GEMINI_PROJECT_DIR', 'AGENT_UNDO_LEVEL'];

/** Fresh project dir + isolated snapshot store. Sets AGENT_UNDO_HOME for this process. */
function sandbox() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-undo-test-')));
  const project = path.join(tmp, 'project');
  const home = path.join(tmp, 'store');
  fs.mkdirSync(project);
  process.env.AGENT_UNDO_HOME = home;
  // Delete pruned snapshots inline so temp-dir cleanup never races the background deleter.
  process.env.AGENT_UNDO_SYNC_DELETE = '1';
  const p = (rel) => path.join(project, rel);
  // eslint-disable-next-line no-use-before-define
  const write = (rel, content) => { fs.mkdirSync(path.dirname(p(rel)), { recursive: true }); fs.writeFileSync(p(rel), content); };
  const read = (rel) => fs.readFileSync(p(rel), 'utf8');
  const exists = (rel) => fs.existsSync(p(rel));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  write('package.json', '{}'); // project marker: hooks only auto-snapshot real projects
  // Host env vars change hook output shape and the MCP default dir; tests set them explicitly.
  const env = { ...process.env, AGENT_UNDO_HOME: home };
  for (const k of HOST_VARS) delete env[k];
  return { tmp, project, home, p, write, read, exists, cleanup, env };
}

module.exports = { ROOT, BIN, sandbox };
