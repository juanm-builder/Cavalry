# Budget Services

Budget services split mutable budget workflows from browser-safe route summaries.

Files:

- `budget-service.js` coordinates budget line items, sheet budget maps, budget status, and budget mutations.
- `budget-route-view-model-service.js` builds read-only route data for the renderer and dashboard.

`budget-route-view-model-service.js` is renderer-safe. The Mac budget controller clones the workbook before using `budget-service.js`, then returns the standard `{ ok, workbook, events, warnings, errors }` result. Save, modal, and notification effects remain in the app.

Coverage: `tests/application/budget-service.test.js`, `tests/application/budget-route-view-model-service.test.js`, and the Mac renderer budget interaction tests. Run them through the owning workspaces or the root `npm run test` gate.
