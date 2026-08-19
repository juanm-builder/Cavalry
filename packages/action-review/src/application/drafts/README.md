# Draft Application Services

Draft services keep external draft review, source metadata display, conflict detection, and apply/reject workflows out of ad hoc renderer helpers.

Files:

- `draft-review-projection.js` and `draft-source-metadata-view-model-service.js` build provider-neutral read-only display models.
- `draft-group-model.js`, `draft-group-service.js`, `draft-conflict-service.js`, `duplicate-detection.js`, and `review-url.js` normalize draft review data and detect review state.
- `draft-apply-service.js` and `external-draft-service.js` own apply/reject and external draft group workflows.

Advisor-dependent card and queue projections live in `@cavalry/advisor/application/drafts`.

Renderer-owned behavior lives in `apps/desktop/src/renderer/features/drafts/`: serializable card models, explicit edit/apply/reject/hide callbacks, source navigation, selection state, and save/navigation effects. The feature renders React elements rather than package-produced HTML.

Do not import Tauri, Node-only modules, desktop bridges, provider clients, filesystem access, `window`, or `document` into browser-safe draft display modules. Do not change draft apply/reject/hide/edit semantics, source contracts, Advisor trust labels, or Companion/API draft shapes without focused parity coverage.

Browser-safe modules:

- `draft-review-projection.js`
- `draft-source-metadata-view-model-service.js`

Node/main/server-only modules: none in this directory; provider, IPC, and server boundaries belong outside this folder.

Package coverage: `tests/application/draft-*.test.js`, `tests/application/chatgpt-action-fixtures.test.js`, and `tests/application/external-draft-service.test.js`. Run it with `npm test --workspace @cavalry/action-review`; renderer integration stays in the Mac workspace.
