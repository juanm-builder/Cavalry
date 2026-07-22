# Import/Export Application Services

Import/export services parse files, build import previews, apply approved imports, and export workbook data while the Mac app owns file selection, preview UI, downloads, persistence, and user decisions.

Files:

- `csv-import-parser.js` parses CSV rows into normalized import candidates.
- `import-preview-service.js` builds read-only preview results before mutation.
- `import-apply-service.js` applies approved previews to workbook data and supports cancel behavior.
- `export-service.js` and `chatgpt-context-pack-export.js` handle export payloads and ChatGPT context-pack shapes.

Renderer-owned behavior lives in `apps/mac/src/renderer/features/import-export/` and the transaction controller. It uses injected file-picker and download ports, renders the preview modal, requests confirmation, and sends immutable command results to the workbook session.

Do not import Electron, Node-only modules, preload bridges, filesystem access, provider calls, `window`, or `document` here. Do not change CSV parsing, import apply behavior, transaction posting, workbook schema, or portable workbook format without focused import/export and workbook parity coverage.

Browser-safe modules:

- `csv-import-parser.js`
- `import-preview-service.js`
- `import-apply-service.js`
- `export-service.js`
- `chatgpt-context-pack-export.js`

Node/main/server-only modules: none in this directory.

Package coverage includes the CSV parser, preview, apply, export, and round-trip tests under `tests/application/`; Mac route and file-effect coverage lives under `apps/mac/tests/renderer/` and `apps/mac/tests/application/`.
