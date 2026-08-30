# Cavalry host sidecars

This directory intentionally contains no committed executable binaries.

`npm run sidecar:prepare --workspace @cavalry/desktop` builds the bundled Node host and creates the target-specific executable that Tauri expects:

- `cavalry-host-aarch64-apple-darwin`
- `cavalry-host-x86_64-apple-darwin`

Generated sidecars are ignored by Git. Release CI must rebuild them from source for each target before invoking Tauri.
