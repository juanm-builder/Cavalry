# Checkpoint Application Services

Checkpoint services prepare checkpoint review display data and coordinate checkpoint lifecycle workflows for Companion/checkpointed apply.

Files:

- `checkpoint-review-view-model-service.js` builds browser-safe review panel, picker, and change-row display models.
- `checkpoint-review-projection.js` shapes checkpoint review inputs for display and tests.
- `checkpoint-service.js`, `checkpoint-store.js`, `rollback-service.js`, and `checkpoint-audit.js` own checkpoint creation, storage, rollback preview/apply, and audit events.

Renderer-owned behavior lives in `apps/desktop/src/renderer/features/drafts/`: opening review targets, rendering panels, explicit confirmations, navigation, and applying controller results. Deep-link selection enters through the workbook session and route registry.

Do not import Tauri, Node-only modules, desktop bridges, filesystem access, provider calls, `window`, or `document` into browser-safe review modules. Do not change checkpoint IDs, action-plan execution, rollback semantics, auth, or Companion/API response shapes from this directory without checkpoint/API parity coverage.

Browser-safe modules:

- `checkpoint-review-view-model-service.js`
- `checkpoint-review-projection.js`

Node/main/server-only modules: none in this directory; privileged serving and auth belong in `@cavalry/companion-api` and the Mac main-process adapters.

Package coverage: `tests/domain/checkpoints.test.js`, `tests/application/checkpoint-review-view-model-service.test.js`, and `tests/application/checkpointed-action-executor.test.js`. Run it with `npm test --workspace @cavalry/action-review`; Companion API checkpoint coverage lives with `@cavalry/companion-api`.
