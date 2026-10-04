---
name: undo-gain
description: >
  Show agent-undo's scoreboard: snapshots taken (by trigger), average snapshot
  time, reverts and partial reverts, and data protected for this project.
  One-shot display. Trigger: /undo-gain, "undo stats", "how many snapshots",
  "what has agent-undo saved".
---

# Undo Gain

One-shot. Call `undo_status`, then render the stats as a compact card.
Change nothing.

```
⏪ agent-undo 1.2.0 · level full
snapshots   48  (hook 31 · session 9 · manual 6 · pre-revert 2) · avg 41ms
reverts     3   (2 partial · 5 paths restored)
project     7 snapshots · latest 12m ago
engine      clonefile ✓ · same volume ✓
```

- Averages: `snapshotMsTotal / snapshots`, rounded.
- Show any `warn`/`FAIL` environment check under the card, one line each,
  with its fix.
- For "data protected" in MB, the user can run `agent-undo stats` in a
  terminal. It walks the snapshot store, so it is not done here.
