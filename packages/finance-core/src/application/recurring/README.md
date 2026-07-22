# Recurring Application Services

Recurring services prepare Bills route display data, recurring analysis, and browser-safe recurring tracker command mutations without taking over payment or subscription UI workflows.

Files:

- `bills-route-view-model-service.js` builds browser-safe Bills route stats, recurring rows, due-next rows, subscription review rows, pagination labels, and monthly totals.
- `recurring-analysis-service.js` analyzes recurring transaction patterns and subscription candidates.
- `recurring-command-service.js` creates recurring trackers from expense transactions and links transactions to existing trackers, returning renderer effects instead of touching modal/save/render state directly.

Renderer-owned behavior lives in `apps/mac/src/renderer/features/recurring/`: bill row markup, editors, archive/pay actions, explicit confirmations, subscription review actions, and controller-to-session save effects.

Do not import Electron, Node-only modules, preload bridges, filesystem access, provider calls, `window`, or `document` here. Do not change scheduled transaction generation, amount signs, due/overdue/upcoming labels, account/category labels, ordering, or payment behavior without focused parity coverage.

Browser-safe modules:

- `bills-route-view-model-service.js`
- `recurring-analysis-service.js`
- `recurring-command-service.js`

Node/main/server-only modules: none in this directory.

Package coverage includes Bills view models, recurring analysis, command behavior, and migration under `tests/application/`; Mac renderer coverage exercises the route and controller interactions.
