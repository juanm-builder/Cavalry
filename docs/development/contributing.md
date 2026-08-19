# Contributor workflow

The canonical contribution guide is [CONTRIBUTING.md](../../CONTRIBUTING.md). This page summarizes the technical handoff expected for desktop changes.

1. Identify the owning layer before editing.
2. Preserve workbook schema and ledger invariants unless the change explicitly includes a migration.
3. Keep native access behind the Tauri adapter or host protocol.
4. Add focused tests at the owning layer.
5. Update relevant documentation and release notes.
6. Run architecture, JavaScript, Rust, and native checks appropriate to the change.

A desktop migration or packaging change is not complete merely because the renderer builds. It must account for platform identities, data directories, deep links, secure storage, updater transition, code signing, and real-WebView behavior.
