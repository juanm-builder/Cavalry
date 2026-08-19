# Dashboard Services

Dashboard services are browser-safe, read-only view-model builders for the React dashboard controller and route. They prepare plain data for cards plus category and flow drilldown modals; they do not render HTML, mutate workbook state, call IPC, or access Node/Tauri APIs.

Files:

- `dashboard-route-view-model-service.js` builds route-level dashboard summaries.
- `dashboard-category-drilldown-view-model-service.js` builds category drilldown modal data.
- `dashboard-flow-drilldown-view-model-service.js` builds flow drilldown modal data.
- `dashboard-view-model-helpers.js` contains shared non-financial label, date, clone, and coercion helpers.

Financial calculations remain in domain/report/budget services. Keep dashboard helpers small and avoid moving ledger math, budget math, transaction posting, or renderer modal behavior here.

Coverage: `tests/application/dashboard-*.test.js`, `tests/application/dashboard-view-model-helpers.test.js`, and `tests/architecture/browser-safe-boundary.test.js`.
