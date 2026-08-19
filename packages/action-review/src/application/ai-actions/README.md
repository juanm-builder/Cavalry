# AI Action Application Services

AI action services validate and execute Advisor/Companion action plans through explicit application workflows.

Files:

- `blocked-actions.js` defines action types that are refused or require checkpointed handling.
- `checkpointed-action-executor.js` validates checkpointed action plans, prepares checkpoint diffs, and applies approved actions through domain/application helpers.

Renderer-owned behavior lives in `apps/desktop/src/renderer/features/drafts/`: the React review route, explicit action callbacks, source navigation, confirmations, and controller effects.

Server/API-owned behavior stays in `packages/companion-api/src/server/` and `packages/companion-api/src/application/api/`: auth, scopes, request handling, response serialization, and audit routing.

Do not import Tauri, Node-only modules, desktop bridges, filesystem access, provider clients, `window`, or `document` here. Do not change checkpoint apply semantics, action-plan validation, rollback/diff shapes, API auth/scopes, or OpenAPI-visible behavior without checkpoint/API parity coverage.

These modules are platform-independent and adapter-driven so the Mac controller and Companion server can exercise the same safety workflow without privileged imports.

Node/main/server-only modules: none in this directory.

Package coverage: `tests/application/checkpointed-action-executor.test.js` and the checkpoint domain/application suites. Run it with `npm test --workspace @cavalry/action-review`; Companion HTTP and CLI coverage lives in `@cavalry/companion-api`.
