# Category Application Services

Category services separate category route display data from category and linked-account workflow rules.

Files:

- `category-view-model-service.js` builds browser-safe category rows, linked account labels, usage counts, and fallback display values.
- `category-management-service.js` owns create, rename, hide/restore, delete, linked-account replacement, and usage validation workflows.

Renderer-owned behavior lives in `apps/mac/src/renderer/features/categories/`: forms, explicit confirmations, markup, modal state, navigation, and controller-to-session save effects.

Do not import Electron, Node-only modules, preload bridges, filesystem access, provider calls, `window`, or `document` here. Keep workbook mutations explicit and covered by focused workflow tests.

Browser-safe modules:

- `category-view-model-service.js`
- `category-management-service.js` when imported by renderer workflow handlers

Node/main/server-only modules: none in this directory.

Package coverage lives in `tests/application/category-management-service.test.js` and `tests/application/category-view-model-service.test.js`; route/controller interaction coverage lives in `apps/mac/tests/renderer/`. Run them through the owning workspaces or the root `npm run test` gate.
