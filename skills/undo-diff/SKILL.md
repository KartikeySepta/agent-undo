---
name: undo-diff
description: >
  Show what changed in the project since an agent-undo snapshot, i.e. what a
  revert would throw away, grouped and summarized. One-shot, read-only.
  Trigger: /undo-diff [snapshot], "what changed since the snapshot", "what
  would revert undo", "what did you change".
argument-hint: "[snapshot]"
---

# Undo Diff

Read-only. Never revert from this skill.

1. Call `diff_snapshot` (with the argument as `snapshot` if given; default latest).
2. Summarize, do not dump. Group the paths:
   - **Your changes this session**: files you edited or created.
   - **Not yours**: files you did not touch (the user's edits, tools, watchers).
   - **Generated / dependencies**: `node_modules/`, lockfiles, build output, caches. Count them, don't list them.
3. Format:

```
Since <snapshot> (<age>):
  yours     ~ src/api.ts  ~ src/db.ts  + src/cache.ts
  not yours ~ README.md
  deps      312 files under node_modules/, package-lock.json
Revert all would also undo the "not yours" changes. Partial: /undo-revert src/db.ts
```

4. If there are "not yours" changes, call them out first. They are what a
   full revert would destroy.
