# Artifact policy

Source control contains authored source, tests, configuration, documentation, lockfiles, and intentionally curated fixtures. It must not contain generated renderer/main/preload output, packaged applications, coverage, test artifacts, logs, local model weights, user workbooks, runtime configuration, or secrets.

The principal ignored outputs are `apps/mac/dist/`, `apps/mac/out/`, `coverage/`, and any `test-artifacts/` directory. `package-lock.json` and the maintained Companion OpenAPI document are reviewed source artifacts and remain tracked.

Run the architecture tests and inspect `git status --short` before handoff. Packaging performs its own clean build; no source-root bundle is required.
