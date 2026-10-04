# Clone engine benchmark: 2026-10-04

50,000 files, 101 MB, darwin arm64, Apple M4, Node 26.8.2.
Wall-clock of the CLI (includes Node startup). Disk is the free-space delta after the snapshot (approximate).
Revert includes the pre-revert backup.

| Engine | Snapshot | Revert | Disk used |
|---|---|---|---|
| clonefile (koffi) | 419 ms | 433 ms | ~16 MB |
| cp -c / --reflink | 6785 ms | 6489 ms | ~16 MB |
| full copy | 16690 ms | 15427 ms | ~209 MB |

Reproduce: `node benchmarks/clone.mjs 50000`
