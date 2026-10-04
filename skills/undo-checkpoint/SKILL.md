---
name: undo-checkpoint
description: >
  Take a named agent-undo snapshot of the project right now. One-shot. Trigger:
  /undo-checkpoint [name], "checkpoint this", "save a snapshot", "take a
  snapshot before...", "mark this as a good state".
argument-hint: "[name]"
---

# Undo Checkpoint

Take one named snapshot, report it in one line, change nothing else.

1. Pick the name: the argument if given; otherwise a short kebab-case name for
   what is about to happen (`before-auth-refactor`), or `good-<what works>` if
   the user is marking a known-good state (`good-tests-green`).
2. Call `take_snapshot` with that `name`.
3. Reply with one line: `Checkpoint <name> taken (<mode>, <ms>ms).`
   If the mode is `copy`, add: "No copy-on-write here, so snapshots are full
   copies; run `/undo-help` for how to fix that."

Named snapshots are never auto-pruned. Do not list, diff, or revert anything.
