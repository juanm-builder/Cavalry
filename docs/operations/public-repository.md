# Public repository guidance

A public source tree must not expose user data, credentials, signing material, private infrastructure, or local-machine residue.

Before pushing or sharing a source archive:

- run the repository security check;
- inspect the diff for `.env` files, API tokens, local paths, workbooks, logs, databases, and generated bundles;
- exclude `.git`, `node_modules`, `dist`, `target`, sidecar binaries, installers, and updater signatures;
- keep only synthetic fixtures;
- verify documentation describes Tauri rather than removed Electron packaging;
- verify third-party notices include the current Rust/Tauri, system WebView, Node-sidecar, npm, font, and asset boundaries.

A public source ZIP is not a signed application. Native installers must come from a protected, reproducible release workflow and pass the certification checklist.
