# vendor/koffi-runtime

[koffi](https://koffi.dev) 3.3.2 (MIT), reduced to what is needed to call `clonefile(2)` on macOS: the JS loader plus the prebuilt `darwin-arm64` and `darwin-x64` binaries.

Why it is committed: a Claude Code or Codex plugin is installed from this repo without running `npm install`, so the optional `koffi` dependency is missing and snapshots fall back to per-file `cp -c` (6.8 s instead of 0.4 s for 50k files). `src/clone.ts` tries `require('koffi')` first and then this copy.

The layout mirrors `node_modules` (`koffi/` next to `@koromix/`) because koffi's loader finds its native package at `../../../@koromix/koffi-<platform>`. It is not named `node_modules` so `.gitignore` does not drop it.

To update, bump `koffi` in `package.json`, `npm install`, then copy the same files from `node_modules/koffi` and `node_modules/@koromix/koffi-darwin-*`. For the platform you are not on, `npm pack @koromix/koffi-darwin-<arch>@<version>` and check the tarball's sha512 against `package-lock.json` before copying. `tests/vendored-koffi.test.js` checks the pinned versions agree.
