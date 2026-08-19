# Workbook Application Services

Workbook application services coordinate save/load behavior around domain workbook normalization and portable workbook parsing.

Files:

- `workbook-persistence-service.js` parses, normalizes, validates, and serializes portable workbook data using domain workbook and ledger helpers.
- `workbook-session-command-service.js` builds browser-safe workbook replacement effects and scheduled-save command results for the Mac workbook session to apply.

Renderer-owned behavior lives in `apps/desktop/src/renderer/app/` and `apps/desktop/src/renderer/platform/`: hydration state, browser cache, route/overlay state, save status, port orchestration, and user-facing empty/loading/error flows.

Desktop-host-owned behavior stays in `apps/desktop/src/host/workbook-file-controller.cjs`, `workbook-file-persistence.mjs`, and desktop bridges: native file dialogs, recent file tracking, filesystem reads/writes, rolling backups, recovery, and IPC.

Do not import Tauri, desktop bridges, renderer globals, provider clients, `window`, or `document` here. Do not change workbook schema, portable workbook HTML/JSON format, ledger invariant validation, or save/load response shapes without workbook/domain/desktop parity coverage.

Browser-safe modules: `workbook-session-command-service.js` is renderer-facing and must stay free of browser/desktop-bridge/native file APIs.

Node/main/server-only modules: none in this directory; native filesystem work belongs in desktop host/controller code.

Package coverage includes save/load, session commands, normalization, portable parsing, and round trips. Desktop application, renderer, and host tests cover hydration, persistence effects, native file handling, rolling-backup recovery, and save/reopen behavior.
