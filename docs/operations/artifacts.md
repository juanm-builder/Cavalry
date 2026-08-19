# Artifacts and repository hygiene

Source control contains authored source, tests, configuration, lockfiles, documentation, and curated synthetic fixtures. It must not contain generated renderer/host bundles, Rust targets, packaged applications, sidecar executables, updater signatures, coverage, logs, user workbooks, model weights, local application data, or secrets.

Ignored native output includes:

- `apps/desktop/dist/`
- `apps/desktop/src-tauri/target/`
- `apps/desktop/src-tauri/gen/`
- `apps/desktop/src-tauri/binaries/cavalry-host-*`
- `apps/desktop/src-tauri/tauri.release.conf.json`

`apps/desktop/packaging/RUNTIME-DEPENDENCY-INVENTORY.txt` is intentionally generated from `package-lock.json` and bundled as an attribution inventory. Refresh it with `npm run licenses:runtime` when production JavaScript dependencies change.

Before packaging or uploading a repository snapshot, scan for `.env` files, credentials, local paths, databases, logs, archives, packaged applications, and `.git` history. The delivered source ZIP should contain one top-level folder and no dependency or build directories.
