# Reports Services

Reports services are browser-safe read models for cash flow, category breakdowns, period summaries, and account balance summaries. They prepare plain objects for the renderer and dashboard services.

Files:

- `reporting-service.js` owns report calculations over ledger/domain data.
- `reports-route-view-model-service.js` shapes route-ready report view models and should remain renderer-safe.

These files should not import Electron, filesystem, provider, server, or preload code. Workbook mutations belong in the relevant account/category/transaction/budget services, not in reports.

Coverage: `tests/application/reporting-service.test.js`, `tests/application/reports-route-view-model-service.test.js`, and dashboard/route interaction tests in the Mac workspace. Run them through the owning workspaces or the root `npm run test` gate.
