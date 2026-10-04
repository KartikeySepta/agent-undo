# Contributing

Thanks for helping. Keep a PR to one change and link the issue it fixes.

## Dev loop

```bash
npm install
npm test                          # type-check, bundle into bin/, run tests/*.test.js against bin/
node scripts/check-bundles.js     # bin/, AGENTS.md and the Cursor rule match src/ and are committed
node scripts/check-rule-copies.js # every rule copy matches src/instructions.ts
node scripts/check-versions.js    # every manifest carries the same version
```

CI runs all four on macOS (APFS, `clonefile`) and Ubuntu (ext4, the copy fallback) with Node 20,
22 and 24.

## `bin/` is committed

The plugins run without `npm install`, so `bin/*.cjs` are esbuild bundles of `src/` and live in
git. Never edit `bin/` by hand: change `src/`, run `npm run build`, and commit both. CI fails when
they differ.

## Rules have one source

What agents are told lives in [`src/instructions.ts`](src/instructions.ts): `CORE_RULES`, the
per-level notes the hooks inject, and the static ruleset. `npm run build` writes
[`AGENTS.md`](AGENTS.md) and [`.cursor/rules/agent-undo.mdc`](.cursor/rules/agent-undo.mdc) from
it; do not edit those by hand. [`skills/agent-undo/SKILL.md`](skills/agent-undo/SKILL.md) is
hand-written but must carry every rule verbatim, and the Gemini `commands/*.toml` mirror the
`undo-*` skills, so update them together.

A rule change changes what every user's agent does in every session. Explain in the PR what
behavior it fixes, and show a transcript or eval where it makes the difference.

## Hosts

The same hook bundles serve every agent. `src/hooks/common.ts` picks the output shape: the hook
configs for other hosts pass `--platform codex|cursor|gemini`, and without it the host is
detected from its env vars. Claude Code's output must stay unchanged. A new host needs its
output shape in `formatOutput`, its shell tool name in `SHELL_TOOLS`, a manifest, a test in
`tests/platform-hooks.test.js` and `tests/agents-plugin.test.js`, and a section in
[`INSTALL.md`](INSTALL.md). Copy formats from a host's docs or a known-working plugin, not from
memory.

| Host | Files |
|---|---|
| Claude Code | `.claude-plugin/`, `hooks/claude-hooks.json`, `skills/` |
| Codex | `.codex-plugin/`, `.agents/plugins/marketplace.json` |
| Cursor | `hooks/cursor-hooks.json`, `scripts/cursor-hooks.js`, `.cursor/` |
| Gemini CLI | `gemini-extension.json`, `commands/`, `AGENTS.md` |
| OpenCode | `.opencode/plugins/`, `opencode.json` |

Keep `hooks/hooks.json` absent: Gemini CLI auto-loads that path from extensions.

## Benchmark

```bash
npm run bench   # clone-engine benchmark → benchmarks/results/
```

Run it before and after any change to `src/clone.ts` or `src/snapshot.ts` and put both numbers in
the PR.

## Release

```bash
npm version minor   # or patch / major
git push --follow-tags
```

`npm version` runs [`scripts/sync-version.js`](scripts/sync-version.js), which copies the version
into `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `gemini-extension.json` and
`src/version.ts`, rebuilds `bin/`, and stages it all into the version commit. Add new versioned
manifests to both `sync-version.js` and `check-versions.js`. Update
[`CHANGELOG.md`](CHANGELOG.md) before tagging.
