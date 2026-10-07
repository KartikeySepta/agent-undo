# agent-undo installed

Start a new session. What happens from then on, at the default level (**full**):

- The agent gets the agent-undo rules: snapshot before danger, diff before revert, partial reverts first, ask before touching work that isn't its own.
- A baseline snapshot of the project is taken in the background when the session starts.
- Risky shell commands (`rm -rf`, installs, `git reset --hard`, migrations, `sed -i`, …) are snapshotted just before they run.
- Every revert saves a `pre-revert` snapshot first, so a revert can itself be undone.

Automatic snapshots only happen in project directories (`.git`, `package.json`, …), never in your home directory. The top-level `.git` is never snapshotted or touched.

Try:

- `/undo-help`: the reference card.
- `/undo-checkpoint before-refactor`: a named snapshot now.
- `/undo-diff`: what changed since the last snapshot.
- `/undo-revert`: guided rollback.
- `/agent-undo lite|full|paranoid|off`: change the level (or `agent-undo mode <level>` in a terminal).

Check the snapshot engine with `agent-undo doctor` (macOS should report `clonefile(2)`, the fastest path, with nothing to install). Other agents: [INSTALL.md](INSTALL.md).
