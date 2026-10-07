# Security policy

agent-undo deletes and restores files on purpose, and hooks run on every agent tool call, so bugs here can lose data. Please report them privately.

## Reporting

Use GitHub's private reporting: **Security → Report a vulnerability** on [this repository](https://github.com/KartikeySepta/agent-undo/security/advisories/new). Please don't open a public issue for anything below.

Include the version (`agent-undo --version`), your OS, the output of `agent-undo doctor`, and the shortest steps that reproduce it. I aim to acknowledge within 3 days and to fix or give a plan within 14.

## In scope

- A revert or snapshot that reads, writes or deletes **outside the project directory** (symlinks, `..` paths, `.agentundoignore` tricks).
- A revert that discards work the preview did not list, or that bypasses the two-step `confirm_token`.
- Losing data on an interrupted or failed revert (see `agent-undo doctor --repair`).
- A hook that can be made to run attacker-chosen commands from a prompt, a file name or a tool argument.
- Anything in the vendored `vendor/koffi-runtime` that differs from the upstream koffi release.

## Out of scope

- Things the docs say a snapshot can't undo: pushes, deploys, remote or production databases, sent messages, global installs, files outside the project.
- An agent that deliberately calls `revert_environment` with a valid token. Use `/agent-undo paranoid` if you don't want that.
- Denial of service by filling the disk with snapshots (use `agent-undo prune` and `.agentundoignore`).

## Supported versions

Only the latest release on npm gets fixes.
