# Workbook Application Services

Workbook application services coordinate save/load behavior around domain workbook normalization and portable workbook parsing.

Files:

- `workbook-persistence-service.js` parses, normalizes, validates, and serializes portable workbook data using domain workbook and ledger helpers.
- `workbook-session-command-service.js` builds browser-safe workbook replacement effects and scheduled-save command results for the Mac workbook session to apply.

Renderer-owned behavior lives in `apps/mac/src/renderer/app/` and `apps/mac/src/renderer/platform/`: hydration state, browser cache, route/overlay state, save status, port orchestration, and user-facing empty/loading/error flows.

Electron/main-owned behavior stays in `apps/mac/src/main/workbook-file-controller.cjs`, `workbook-file-persistence.mjs`, and preload bridges: native file dialogs, recent file tracking, filesystem reads/writes, rolling backups, recovery, and IPC.

Do not import Electron, preload bridges, renderer globals, provider clients, `window`, or `document` here. Do not change workbook schema, portable workbook HTML/JSON format, ledger invariant validation, or save/load response shapes without workbook/domain/Electron parity coverage.

Browser-safe modules: `workbook-session-command-service.js` is renderer-facing and must stay free of browser/preload/native file APIs.

Node/main/server-only modules: none in this directory; native filesystem work belongs in Electron main/controller code.

Package coverage includes save/load, session commands, normalization, portable parsing, and round trips. Mac application, renderer, and Electron tests cover hydration, persistence effects, native file handling, rolling-backup recovery, and save/reopen behavior.
