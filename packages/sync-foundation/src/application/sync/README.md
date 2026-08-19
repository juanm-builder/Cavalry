# Sync Application Services

Sync services define the local-only cloud sync foundation and conflict/readiness behavior.

Files:

- `sync-types.js` defines sync object types, adapter capabilities, and status values.
- `sync-change-log.js` creates and summarizes local workbook change entries.
- `local-sync-adapter.js` implements the local mock adapter.
- `sync-conflict-service.js` detects local conflict conditions.
- `sync-readiness-service.js` reports cloud sync readiness and safety constraints.

Renderer-owned behavior stays in UI routes and controls; this folder should not decide modal copy, click handlers, route state, or save/rerender timing.

Server/desktop-adapter-owned behavior stays outside this directory. Future remote network adapters, credentials, filesystem access, and IPC should live behind explicit adapters rather than inside these core sync rules.

Do not import Tauri, Node-only modules, desktop bridges, filesystem access, provider clients, `window`, or `document` here. Do not change workbook mutation semantics, conflict detection meanings, or readiness status shapes without focused sync coverage.

Browser-safe modules:

- `sync-types.js`
- `sync-change-log.js`
- `local-sync-adapter.js`
- `sync-conflict-service.js`
- `sync-readiness-service.js`

Node/main/server-only modules: none in this directory.

Coverage: `tests/application/sync-change-log.test.js`, `tests/application/local-sync-adapter.test.js`, `tests/application/sync-conflict-service.test.js`, and `tests/application/cloud-sync-readiness.test.js`. Run it with `npm test --workspace @cavalry/sync-foundation`.
