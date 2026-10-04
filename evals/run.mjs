#!/usr/bin/env node
// Behavioral evals for agent-undo: does loading the plugin change what the agent does?
//
//   node evals/run.mjs validate                       check every fixture, no claude calls
//   node evals/run.mjs [run] [--scenario a,b] [--condition baseline|candidate|both]
//                      [--trials N] [--model haiku] [--max-runs 30] [--jobs 1] [--dry-run]
//   node evals/run.mjs rescore <run-dir>              re-score saved runs (sandboxes must still exist)
//
// baseline  = the agent-undo MCP server via --mcp-config (tools exist) but no plugin: no skill, hooks or rules.
// candidate = the plugin via --plugin-dir (skills + hooks + the same MCP server).
// Both run isolated from the operator's own config (--setting-sources project,local, --strict-mcp-config),
// each in a fresh temp project with its own AGENT_UNDO_HOME, so nothing touches ~/.agent-undo.
// Scoring is deterministic: tool-call order from the stream-json transcript, the filesystem, and the store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS_DIR = path.join(ROOT, 'evals', 'scenarios');
const RUNS_DIR = path.join(ROOT, 'evals', 'results', 'runs');
const CLI = path.join(ROOT, 'bin', 'agent-undo.cjs');
const MCP = path.join(ROOT, 'bin', 'agent-undo-mcp.cjs');
const LEVELS = ['off', 'lite', 'full', 'paranoid'];
const CONDITIONS = ['baseline', 'candidate'];
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const UNDO_TOOLS = ['take_snapshot', 'list_snapshots', 'diff_snapshot', 'revert_environment', 'undo_status'];
// A revert_environment call answered with a preview (two-step revert, no valid confirm) reverted
// nothing: it is scored as `revert_preview`, never as a revert. Older servers never preview.
const VIRTUAL_TOOLS = ['revert_preview'];
const PREVIEW_RE = /PREVIEW ONLY: nothing was reverted|does not match this revert/;
const anyOf = (t) => (Array.isArray(t) ? t : [t]);

// ---------------------------------------------------------------- check registry

/** Each check: required params, and fn(ctx, check) -> { pass, detail }. */
const CHECKS = {
  tool_called: {
    params: ['tool'],
    fn: (c, k) => { const n = anyOf(k.tool).flatMap((t) => c.ok(t)).length; return res(n > 0, `${n} successful ${anyOf(k.tool).join('/')} call(s)`); },
  },
  tool_not_called: { params: ['tool'], fn: (c, k) => res(c.calls(k.tool).length === 0, `${c.calls(k.tool).length} call(s)`) },
  max_calls: { params: ['tool', 'max'], fn: (c, k) => res(c.calls(k.tool).length <= k.max, `${c.calls(k.tool).length} call(s), max ${k.max}`) },
  bash_ran: {
    params: ['pattern'],
    fn: (c, k) => { const b = c.bash(k.pattern); return res(b.length > 0, b.length ? `#${b[0].i}: ${b[0].input.command.slice(0, 80)}` : 'no matching command'); },
  },
  called_before: {
    params: ['first', 'then'],
    fn: (c, k) => {
      const then = c.calls(k.then)[0];
      if (!then) return res(!!k.vacuous, `${k.then} never called`);
      const first = anyOf(k.first).flatMap((t) => c.calls(t)).sort((a, b) => a.i - b.i)[0];
      const label = anyOf(k.first).join('/');
      return res(!!first && first.i < then.i, first ? `${first.short} #${first.i}, ${k.then} #${then.i}` : `${k.then} #${then.i} with no ${label} before it`);
    },
  },
  snapshot_before_bash: {
    params: ['pattern'],
    fn: (c, k) => {
      const risky = c.bash(k.pattern)[0];
      if (!risky) return res(false, 'risky command not observed');
      const snaps = c.ok('take_snapshot').filter((s) => s.i < risky.i && (!k.named || String(s.input.name ?? '').trim()));
      if (snaps.length) return res(true, `take_snapshot "${snaps[0].input.name ?? ''}" #${snaps[0].i} before risky #${risky.i}`);
      // any_trigger: the PreToolUse hook's snapshot counts too. The hook runs before the tool, so a
      // hook snapshot whose reason names a Bash call at or before the risky one existed before it.
      if (k.any_trigger) {
        const bashes = c.calls('Bash');
        const hook = c.storeSnaps.filter((m) => m.trigger === 'hook').find((m) => {
          const cmd = String(m.reason ?? '').replace(/^auto: /, '');
          const at = bashes.find((b) => (b.input.command ?? '').slice(0, 80) === cmd);
          return at && at.i <= risky.i;
        });
        if (hook) return res(true, `hook snapshot before risky #${risky.i} (${hook.reason})`);
      }
      return res(false, `no ${k.named ? 'named ' : ''}${k.any_trigger ? 'manual or hook ' : 'take_snapshot '}snapshot before risky #${risky.i}: ${risky.input.command.slice(0, 60)}`);
    },
  },
  revert_used_paths: {
    params: [],
    fn: (c, k) => {
      const reverts = c.ok('revert_environment');
      if (!reverts.length) return res(false, 'no successful revert');
      const bad = (p) => (k.excludes ?? []).some((x) => covers(p, x));
      const good = reverts.filter((r) => Array.isArray(r.input.paths) && r.input.paths.length && !r.input.paths.some(bad));
      return res(good.length === reverts.length, reverts.map((r) => JSON.stringify(r.input.paths ?? 'ALL')).join('; '));
    },
  },
  max_edits_before_revert: {
    params: ['paths', 'max'],
    fn: (c, k) => {
      const rev = c.calls('revert_environment')[0];
      const n = c.writesTo(k.paths).filter((w) => !rev || w.i < rev.i).length;
      return res(n <= k.max, `${n} write(s) to ${k.paths.join(', ')} before ${rev ? 'the first revert' : 'the end (no revert)'}`);
    },
  },
  no_edit_after_revert: {
    params: ['paths'],
    fn: (c, k) => {
      const rev = c.ok('revert_environment')[0];
      if (!rev) return res(false, 'no successful revert');
      const n = c.writesTo(k.paths).filter((w) => w.i > rev.i).length;
      return res(n === 0, `${n} write(s) to ${k.paths.join(', ')} after the revert`);
    },
  },
  command_passes: {
    params: ['command'],
    fn: (c, k) => {
      const r = spawnSync('sh', ['-c', k.command], { cwd: c.project, encoding: 'utf8', timeout: 30_000, env: c.env });
      return res(r.status === 0, r.status === 0 ? 'exit 0' : `exit ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0]?.slice(0, 120)}`);
    },
  },
  path_absent: { params: ['path'], fn: (c, k) => res(!fs.existsSync(path.join(c.project, k.path)), k.path) },
  outside_path_absent: { params: ['path'], fn: (c, k) => res(!fs.existsSync(path.join(c.sandbox, k.path)), k.path) },
  file_contains: { params: ['path', 'pattern'], fn: (c, k) => { const t = readOr(path.join(c.project, k.path)); return res(t !== null && new RegExp(k.pattern, k.flags).test(t), t === null ? 'missing' : k.path); } },
  file_not_contains: { params: ['path', 'pattern'], fn: (c, k) => { const t = readOr(path.join(c.project, k.path)); return res(t !== null && !new RegExp(k.pattern, k.flags).test(t), t === null ? 'missing' : k.path); } },
  file_unchanged: {
    params: ['path'],
    fn: (c, k) => {
      const now = hashFile(path.join(c.project, k.path));
      return res(now !== null && now === c.setupHashes[k.path], now === null ? 'missing' : now === c.setupHashes[k.path] ? 'identical' : 'changed');
    },
  },
  final_text_matches: {
    params: ['pattern'],
    fn: (c, k) => res(new RegExp(k.pattern, k.flags).test(c.finalText), JSON.stringify(c.finalText.replace(/\s+/g, ' ').slice(0, 100))),
  },
};

const res = (pass, detail) => ({ pass: !!pass, detail });
const norm = (p) => path.posix.normalize(String(p).replace(/\\/g, '/').replace(/^\.\//, '')).replace(/\/$/, '');
/** True if reverting path `p` would also touch `target` (p is target or one of its parents). */
const covers = (p, target) => { const a = norm(p), b = norm(target); return a === '.' || a === b || b.startsWith(a + '/'); };
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const hashFile = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };

// ---------------------------------------------------------------- scenarios

function loadScenarios(filter) {
  const ids = fs.readdirSync(SCENARIOS_DIR).filter((d) => fs.statSync(path.join(SCENARIOS_DIR, d)).isDirectory()).sort();
  const wanted = filter ? filter.split(',').map((s) => s.trim()) : ids;
  for (const w of wanted) if (!ids.includes(w)) throw new Error(`unknown scenario: ${w} (have: ${ids.join(', ')})`);
  return wanted.map((id) => ({ ...JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, id, 'scenario.json'), 'utf8')), dir: path.join(SCENARIOS_DIR, id) }));
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...listFiles(dir, r)); else out.push(r);
  }
  return out;
}

/**
 * Fresh sandbox: <tmp>/project (the scenario) and <tmp>/remote (outside the project). The store
 * (AGENT_UNDO_HOME) gets its own temp dir, not a sibling of project/: in r2 a baseline agent found
 * a sibling store/ and copied files straight out of a snapshot, bypassing the tools.
 */
function prepare(scenario, label) {
  const base = fs.realpathSync(os.tmpdir());
  const sandbox = fs.mkdtempSync(path.join(base, `agent-undo-eval-${label}-`));
  const project = path.join(sandbox, 'project');
  const store = fs.mkdtempSync(path.join(base, 'agent-undo-eval-home-'));
  fs.mkdirSync(path.join(sandbox, 'remote'));
  fs.cpSync(path.join(scenario.dir, 'template'), project, { recursive: true });
  for (const f of listFiles(project)) if (f.endsWith('.sh')) fs.chmodSync(path.join(project, f), 0o755);
  const env = { ...process.env, AGENT_UNDO_HOME: store, AGENT_UNDO_SYNC_DELETE: '1', AGENT_UNDO_LEVEL: scenario.level };
  delete env.CLAUDECODE;
  for (const step of scenario.setup) {
    if (step.snapshot) {
      const r = spawnSync(process.execPath, [CLI, 'snapshot', step.snapshot], { cwd: project, env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`${scenario.id}: seeding snapshot failed: ${r.stderr}`);
    }
    if (step.overlay) fs.cpSync(path.join(scenario.dir, step.overlay), project, { recursive: true, force: true });
  }
  const setupHashes = Object.fromEntries(listFiles(project).map((f) => [f, hashFile(path.join(project, f))]));
  const setupSnapshots = new Set(storeSnapshots(store).map((s) => s.id));
  return { sandbox, project, store, env, setupHashes, setupSnapshots };
}

function storeSnapshots(store) {
  const root = path.join(store, 'snapshots');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const h of fs.readdirSync(root)) {
    for (const id of fs.readdirSync(path.join(root, h))) {
      const meta = readOr(path.join(root, h, id, 'meta.json'));
      if (meta) out.push(JSON.parse(meta));
    }
  }
  return out;
}

// ---------------------------------------------------------------- transcript

function parseTranscript(text) {
  const events = text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const calls = [];
  const results = new Map();
  let init = null, result = null, lastText = '';
  for (const e of events) {
    if (e.type === 'system' && e.subtype === 'init') init = e;
    if (e.type === 'result') result = e;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    for (const b of content) {
      if (e.type === 'assistant' && b.type === 'tool_use') calls.push({ i: calls.length, id: b.id, name: b.name, short: shortName(b.name), input: b.input ?? {} });
      if (e.type === 'assistant' && b.type === 'text' && b.text?.trim()) lastText = b.text;
      if (e.type === 'user' && b.type === 'tool_result') {
        const t = Array.isArray(b.content) ? b.content.map((x) => x.text ?? '').join('\n') : String(b.content ?? '');
        results.set(b.tool_use_id, { isError: !!b.is_error || /^Error:/.test(t), text: t });
      }
    }
  }
  for (const c of calls) {
    c.result = results.get(c.id) ?? { isError: true, text: '(no result)' };
    if (c.short === 'revert_environment' && PREVIEW_RE.test(c.result.text)) c.short = 'revert_preview';
  }
  return { init, result, calls, finalText: (typeof result?.result === 'string' && result.result) || lastText };
}

/** mcp__agent-undo__take_snapshot and mcp__plugin_agent-undo_agent-undo__take_snapshot -> take_snapshot. */
function shortName(name) {
  const m = /^mcp__.*agent-undo.*__(\w+)$/.exec(name);
  return m && UNDO_TOOLS.includes(m[1]) ? m[1] : name;
}

function context(t, prep) {
  const calls = (tool) => t.calls.filter((c) => c.short === tool);
  const rel = (f) => norm(path.isAbsolute(f) ? path.relative(prep.project, f) : f);
  return {
    ...prep,
    storeSnaps: storeSnapshots(prep.store).filter((m) => !prep.setupSnapshots.has(m.id)),
    finalText: t.finalText ?? '',
    calls,
    ok: (tool) => calls(tool).filter((c) => !c.result.isError),
    bash: (pattern) => calls('Bash').filter((c) => new RegExp(pattern, 'i').test(c.input.command ?? '')),
    writesTo: (paths) => t.calls.filter((c) => {
      if (EDIT_TOOLS.has(c.short)) return paths.some((p) => rel(c.input.file_path ?? c.input.notebook_path ?? '') === norm(p));
      if (c.short === 'Bash') return paths.some((p) => (c.input.command ?? '').includes(p) && /(>|\bsed\s+-i|\btee\b|writeFile|\bcp\b|\bmv\b)/.test(c.input.command));
      return false;
    }),
  };
}

function score(scenario, transcriptText, prep) {
  const t = parseTranscript(transcriptText);
  const ctx = context(t, prep);
  const checks = scenario.checks.map((k) => {
    let r;
    try { r = CHECKS[k.type].fn(ctx, k); } catch (e) { r = res(false, `check error: ${e.message}`); }
    return { id: k.id, required: k.required !== false, ...r };
  });
  const required = checks.filter((c) => c.required);
  const sessionSnaps = storeSnapshots(prep.store).filter((s) => !prep.setupSnapshots.has(s.id));
  const byTrigger = {};
  for (const s of sessionSnaps) byTrigger[s.trigger ?? 'manual'] = (byTrigger[s.trigger ?? 'manual'] ?? 0) + 1;
  const toolCounts = {};
  for (const c of t.calls) toolCounts[c.short] = (toolCounts[c.short] ?? 0) + 1;
  return {
    pass: required.length > 0 && required.every((c) => c.pass),
    requiredPassed: required.filter((c) => c.pass).length,
    requiredTotal: required.length,
    checks,
    toolSequence: t.calls.map((c) => (c.short === 'Bash' ? `Bash(${(c.input.command ?? '').slice(0, 50)})` : [...UNDO_TOOLS, ...VIRTUAL_TOOLS].includes(c.short) ? `${c.short}${c.input.paths ? `(paths=${JSON.stringify(c.input.paths)})` : c.input.name ? `(${c.input.name})` : c.input.snapshot ? `(${c.input.snapshot})` : ''}${c.input.confirm ? '+confirm' : ''}` : EDIT_TOOLS.has(c.short) ? `${c.short}(${path.basename(c.input.file_path ?? '')})` : c.short)),
    toolCounts,
    sessionSnapshotsByTrigger: byTrigger,
    finalText: t.finalText,
    model: t.init?.model ?? null,
    claudeVersion: t.init?.claude_code_version ?? null,
    undoToolsVisible: (t.init?.tools ?? []).filter((n) => UNDO_TOOLS.includes(shortName(n))).length,
    costUsd: t.result?.total_cost_usd ?? null,
    turns: t.result?.num_turns ?? null,
    resultSubtype: t.result?.subtype ?? null,
  };
}

// ---------------------------------------------------------------- claude

// Both conditions get the identical agent-undo MCP server through --mcp-config, so the tool surface
// (names, descriptions) is the same and the only difference is the plugin's skills, hooks and rules.
// (--strict-mcp-config, needed to keep the operator's own MCP servers out, also drops a --plugin-dir
// plugin's MCP server, so the plugin cannot supply it here.)
function claudeArgs(scenario, condition, model, budget) {
  const args = [
    '-p', scenario.prompt,
    '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--model', model,
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-mode', 'dontAsk',
    '--max-budget-usd', String(budget),
    '--allowedTools', 'Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'Skill', 'TodoWrite', 'mcp__agent-undo',
    '--mcp-config', JSON.stringify({ mcpServers: { 'agent-undo': { command: process.execPath, args: [MCP] } } }),
  ];
  if (condition === 'candidate') args.push('--plugin-dir', ROOT);
  return args;
}

function runClaude(args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => { err += `\n[run.mjs] timeout after ${timeoutMs}ms, killed`; child.kill('SIGTERM'); }, timeoutMs);
    child.on('error', (e) => { err += `\n[run.mjs] spawn error: ${e.message}`; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - started }); });
  });
}

// ---------------------------------------------------------------- commands

function validate() {
  const errors = [];
  const scenarios = loadScenarios();
  if (scenarios.length < 6) errors.push(`expected at least 6 scenarios, found ${scenarios.length}`);
  for (const s of scenarios) {
    const e = (m) => errors.push(`${s.id}: ${m}`);
    if (s.id !== path.basename(s.dir)) e(`id "${s.id}" does not match its directory`);
    if (typeof s.prompt !== 'string' || s.prompt.trim().length < 10) e('prompt missing');
    if (!LEVELS.includes(s.level)) e(`level must be one of ${LEVELS.join('|')}`);
    if (!fs.existsSync(path.join(s.dir, 'template', 'package.json'))) e('template/package.json missing (hooks only act in project dirs)');
    if (!Array.isArray(s.setup)) e('setup must be an array');
    for (const step of s.setup ?? []) {
      if (!step.snapshot && !step.overlay) e(`unknown setup step ${JSON.stringify(step)}`);
      if (step.overlay && !fs.existsSync(path.join(s.dir, step.overlay))) e(`overlay dir ${step.overlay} missing`);
    }
    if (!Array.isArray(s.checks) || !s.checks.some((k) => k.required !== false)) e('needs at least one required check');
    if (!Array.isArray(s.sanity ?? []) || (s.sanity ?? []).some((x) => typeof x.run !== 'string' || !['pass', 'fail'].includes(x.expect))) e('sanity must be [{ run, expect: pass|fail }]');
    const ids = new Set();
    for (const k of s.checks ?? []) {
      if (ids.has(k.id)) e(`duplicate check id ${k.id}`);
      ids.add(k.id);
      if (!k.description) e(`check ${k.id}: description missing`);
      const def = CHECKS[k.type];
      if (!def) { e(`check ${k.id}: unknown type ${k.type}`); continue; }
      for (const p of def.params) if (k[p] === undefined) e(`check ${k.id}: missing param ${p}`);
      for (const p of ['pattern']) if (k[p] !== undefined) { try { new RegExp(k[p], k.flags); } catch (x) { e(`check ${k.id}: bad regex: ${x.message}`); } }
      if (['tool_called', 'tool_not_called', 'max_calls'].includes(k.type)) {
        for (const tool of anyOf(k.tool)) if (![...UNDO_TOOLS, ...VIRTUAL_TOOLS, 'Bash', ...EDIT_TOOLS].includes(tool)) e(`check ${k.id}: unknown tool ${tool}`);
      }
      if (k.type === 'called_before') for (const tool of [...anyOf(k.first), k.then]) if (![...UNDO_TOOLS, ...VIRTUAL_TOOLS].includes(tool)) e(`check ${k.id}: unknown tool ${tool}`);
    }
    if (errors.some((m) => m.startsWith(s.id + ':'))) continue;
    // Build the sandbox for real (seeded snapshots + overlays) and score an empty transcript:
    // every check must execute without throwing, and file_unchanged targets must exist after setup.
    let prep;
    try {
      prep = prepare(s, 'validate');
      for (const k of s.checks.filter((k) => k.type === 'file_unchanged')) if (!prep.setupHashes[k.path]) e(`check ${k.id}: ${k.path} does not exist after setup`);
      const seeded = storeSnapshots(prep.store).map((m) => m.name);
      for (const step of s.setup.filter((x) => x.snapshot)) if (!seeded.includes(step.snapshot)) e(`seeded snapshot ${step.snapshot} missing from store`);
      const r = score(s, '', prep);
      for (const c of r.checks) if (/check error/.test(c.detail)) e(`check ${c.id}: ${c.detail}`);
      // Sanity steps run in order against the set-up sandbox: they prove the trap still springs
      // (e.g. the migration really destroys data) so a fixture cannot silently rot into a no-op.
      for (const { run: cmd, expect } of s.sanity ?? []) {
        const ok = spawnSync('sh', ['-c', cmd], { cwd: prep.project, env: prep.env, timeout: 30_000 }).status === 0;
        if (ok !== (expect === 'pass')) e(`sanity: \`${cmd}\` should ${expect}`);
      }
    } catch (x) {
      e(`setup failed: ${x.message}`);
    } finally {
      if (prep) for (const d of [prep.sandbox, prep.store]) fs.rmSync(d, { recursive: true, force: true });
    }
  }
  if (errors.length) { console.error(errors.map((m) => `FAIL ${m}`).join('\n')); process.exit(1); }
  console.log(`ok - ${scenarios.length} scenarios valid`);
}

function parseFlags(argv) {
  const f = { condition: 'both', trials: 1, model: 'haiku', maxRuns: 30, jobs: 1, budget: 1, timeout: 420, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--scenario') f.scenario = v();
    else if (a === '--condition') f.condition = v();
    else if (a === '--trials') f.trials = Number(v());
    else if (a === '--model') f.model = v();
    else if (a === '--max-runs') f.maxRuns = Number(v());
    else if (a === '--jobs') f.jobs = Number(v());
    else if (a === '--budget-usd') f.budget = Number(v());
    else if (a === '--timeout') f.timeout = Number(v());
    else if (a === '--out') f.out = v();
    else if (a === '--dry-run') f.dryRun = true;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!['baseline', 'candidate', 'both'].includes(f.condition)) throw new Error('--condition must be baseline|candidate|both');
  if (!(f.trials >= 1) || !(f.maxRuns >= 1) || !(f.jobs >= 1)) throw new Error('--trials, --max-runs, --jobs must be >= 1');
  return f;
}

async function run(argv) {
  const f = parseFlags(argv);
  const scenarios = loadScenarios(f.scenario);
  const conditions = f.condition === 'both' ? CONDITIONS : [f.condition];
  const plan = scenarios.flatMap((s) => Array.from({ length: f.trials }, (_, t) => conditions.map((c) => ({ s, c, trial: t + 1 }))).flat());
  console.log(`plan: ${plan.length} claude run(s) = ${scenarios.length} scenario(s) x ${conditions.length} condition(s) x ${f.trials} trial(s), model ${f.model}`);
  if (plan.length > f.maxRuns) { console.error(`refusing: ${plan.length} runs exceeds --max-runs ${f.maxRuns}`); process.exit(2); }
  if (f.dryRun) { for (const p of plan) console.log(`  ${p.s.id} ${p.c} t${p.trial}`); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = f.out ? path.resolve(f.out) : path.join(RUNS_DIR, `${stamp}-${f.model}`);
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  let next = 0;
  const worker = async () => {
    while (next < plan.length) {
      const { s, c, trial } = plan[next++];
      const label = `${s.id}-${c}-t${trial}`;
      const dir = path.join(outDir, s.id, `${c}-t${trial}`);
      fs.mkdirSync(dir, { recursive: true });
      const prep = prepare(s, `${c}-t${trial}`);
      const args = claudeArgs(s, c, f.model, f.budget);
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
        scenario: s.id, condition: c, trial, model: f.model, sandbox: prep.sandbox, store: prep.store, args,
        setupHashes: prep.setupHashes, setupSnapshots: [...prep.setupSnapshots],
      }, null, 2));
      fs.appendFileSync(path.join(RUNS_DIR, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), run: label, model: f.model, out: outDir }) + '\n');
      console.log(`> ${label}`);
      const r = await runClaude(args, prep.project, prep.env, f.timeout * 1000);
      fs.writeFileSync(path.join(dir, 'transcript.jsonl'), r.out);
      if (r.err.trim()) fs.writeFileSync(path.join(dir, 'stderr.txt'), r.err);
      await new Promise((ok) => setTimeout(ok, 1500)); // let the detached session-baseline snapshot finish
      const sc = { scenario: s.id, condition: c, trial, exitCode: r.code, ms: r.ms, ...score(s, r.out, prep) };
      fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(sc, null, 2));
      rows.push(sc);
      console.log(`< ${label}: ${sc.pass ? 'PASS' : 'FAIL'} (${sc.requiredPassed}/${sc.requiredTotal}) ${sc.costUsd != null ? '$' + sc.costUsd.toFixed(3) : ''} ${(r.ms / 1000).toFixed(0)}s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(f.jobs, plan.length) }, worker));
  writeSummary(outDir, rows, scenarios, f.model);
}

function writeSummary(outDir, rows, scenarios, model) {
  rows.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.condition.localeCompare(b.condition) || a.trial - b.trial);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ model, rows }, null, 2));
  const cell = (id, c) => {
    const rs = rows.filter((r) => r.scenario === id && r.condition === c);
    if (!rs.length) return '-';
    return `${rs.filter((r) => r.pass).length}/${rs.length} (${rs.map((r) => `${r.requiredPassed}/${r.requiredTotal}`).join(', ')})`;
  };
  const lines = ['| scenario | baseline | candidate |', '|---|---|---|'];
  for (const s of scenarios) lines.push(`| ${s.id} | ${cell(s.id, 'baseline')} | ${cell(s.id, 'candidate')} |`);
  for (const c of CONDITIONS) {
    const rs = rows.filter((r) => r.condition === c);
    if (rs.length) lines.push(`\n${c}: ${rs.filter((r) => r.pass).length}/${rs.length} runs passed, cost $${rs.reduce((a, r) => a + (r.costUsd ?? 0), 0).toFixed(2)}`);
  }
  const md = lines.join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md + '\n');
  console.log('\n' + md + `\n\nresults: ${path.relative(process.cwd(), outDir)}`);
}

function rescore(dir) {
  if (!dir) throw new Error('usage: rescore <run-dir>');
  const rows = [];
  const scenarios = loadScenarios();
  for (const s of scenarios) {
    const sdir = path.join(dir, s.id);
    if (!fs.existsSync(sdir)) continue;
    for (const r of fs.readdirSync(sdir)) {
      const meta = JSON.parse(fs.readFileSync(path.join(sdir, r, 'run.json'), 'utf8'));
      const old = JSON.parse(readOr(path.join(sdir, r, 'score.json')) ?? '{}');
      const project = path.join(meta.sandbox, 'project');
      if (!fs.existsSync(project)) { console.error(`skip ${s.id}/${r}: sandbox gone`); continue; }
      const store = meta.store ?? path.join(meta.sandbox, 'store');
      const prep = { sandbox: meta.sandbox, project, store, env: { ...process.env, AGENT_UNDO_HOME: store }, setupHashes: meta.setupHashes, setupSnapshots: new Set(meta.setupSnapshots) };
      const sc = { scenario: s.id, condition: meta.condition, trial: meta.trial, exitCode: old.exitCode, ms: old.ms, ...score(s, fs.readFileSync(path.join(sdir, r, 'transcript.jsonl'), 'utf8'), prep) };
      fs.writeFileSync(path.join(sdir, r, 'score.json'), JSON.stringify(sc, null, 2));
      rows.push(sc);
    }
  }
  writeSummary(dir, rows, scenarios.filter((s) => rows.some((r) => r.scenario === s.id)), rows[0]?.model ?? '?');
}

export { loadScenarios, prepare, score, parseTranscript, claudeArgs };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'validate') validate();
    else if (cmd === 'rescore') rescore(rest[0]);
    else await run(cmd === 'run' || cmd === undefined ? rest : [cmd, ...rest]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
