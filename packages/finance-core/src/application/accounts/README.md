# Account Application Services

Account services keep account display preparation and account mutation workflows out of the renderer.

Files:

- `account-view-model-service.js` builds browser-safe account route rows, balances, labels, and fallback display values.
- `account-management-service.js` owns account create, update, archive/restore, delete, selectable account, and balance-aware workflow helpers.

Renderer-owned behavior lives in `apps/mac/src/renderer/features/accounts/`: forms, table markup, explicit confirmations, modal state, and controller-to-session save effects.

Do not import Electron, Node-only modules, preload bridges, filesystem access, provider calls, `window`, or `document` here. Account posting and balance rules must continue to come from domain ledger helpers rather than renderer-specific calculations.

Browser-safe modules:

- `account-view-model-service.js`
- `account-management-service.js` when imported by renderer workflow handlers

Node/main/server-only modules: none in this directory.

Package coverage lives in `tests/application/account-*.test.js` and `tests/domain/account-balances.test.js`; route/controller interaction coverage lives in `apps/mac/tests/renderer/`. Run them through `npm test --workspace @cavalry/finance-core` and `npm run test:renderer --workspace @cavalry/mac`.
