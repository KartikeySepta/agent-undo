---
name: undo-revert
description: >
  Guided, safe rollback with agent-undo: diff, classify, confirm, then revert
  everything or only the broken paths, verify, and report. Trigger:
  /undo-revert [snapshot|paths...], "undo that", "roll it back", "revert to the
  snapshot", "go back to before you broke it", "restore the last good state".
argument-hint: "[snapshot] [paths...]"
---

# Undo Revert

A revert throws work away. Run this flow every time, in order.

## 1. Pick the target

- Argument names a snapshot → use it. Arguments that are paths → partial revert of those paths against the latest snapshot.
- Otherwise call `list_snapshots` and pick the newest snapshot from **before**
  the breakage: prefer a named one (`before-...`, `good-...`), then a `hook`
  snapshot taken right before the command that broke things. Do not pick a
  snapshot taken after the damage.

## 2. Diff and classify

Call `diff_snapshot` for that snapshot. Sort every change into:
- **broken**: what you are undoing.
- **good**: work that should survive (yours or the user's).
- **not yours**: changes you did not make this session.

## 3. Choose the scope (the undo ladder)

- Only some files broken and good work exists → **partial**: `paths` = the broken files/dirs.
- Environment poisoned (dependency tree, lockfile, codegen, migrations) → **full**.
- Any **not yours** in a full revert → stop and ask: show those paths, offer partial.
- Level **paranoid** → always show the diff summary and get a yes first.

## 4. Revert

Call `revert_environment` with `snapshot` (and `paths` for partial).
Keep the `pre-revert` id from the result: it undoes this revert.

## 5. Verify

Run the cheapest check that proves the environment is healthy again:
the build, the failing test, or the command that broke. If dependencies were
reverted, `node_modules` is back too; do not reinstall unless the check fails.

## 6. Report

```
Reverted to before-react-19-upgrade: 214 files (package.json, lockfile, node_modules/, src/App.tsx).
Kept: src/utils/date.ts (your fix, unrelated).
Build: passing. Undo this revert: revert_environment("2026-...-pre-revert").
Next: upgrade react-dom alone first, then react.
```

Never revert to "make the error go away" without saying what it undid.
