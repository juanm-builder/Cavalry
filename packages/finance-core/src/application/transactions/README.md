# Transactions Application Services

Transaction application services prepare browser-safe transaction form, table, and route view models while domain modules keep ledger posting rules.

Browser-safe modules:

- `transaction-composer-form-model.js`
- `transaction-command-service.js`
- `transaction-submit-intent-service.js`
- `transaction-table-service.js`
- `transaction-route-view-model-service.js`

Renderer-owned behavior lives in `apps/mac/src/renderer/features/transactions/`: table markup, filters, composer/edit/delete modals, explicit confirmations, and controller state. Create/edit/delete mutations flow through `transaction-command-service.js`; the controller returns immutable command results for the workbook session to persist and render.

Do not import Electron, Node-only modules, preload bridges, provider calls, or filesystem access here. Transaction posting and balancing rules belong in `src/domain/ledger/`. Package tests cover commands, form intents, filtering, sorting, inline edit models, totals, and empty states; Mac renderer tests cover user interactions.
