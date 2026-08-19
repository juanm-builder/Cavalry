# Companion API Application Services

API application services implement Companion/Custom GPT contracts behind explicit auth, serialization, audit, and controller boundaries.

Files:

- `cavalry-api-controller.js` coordinates API actions against workbook stores, drafts, checkpoints, and Advisor-safe helpers.
- `cavalry-api-authz.js`, `external-caller-context.js`, and `cavalry-api-errors.js` define scopes, caller context, and safe error behavior.
- `companion-mutation-gate-service.js` centralizes which Companion mutation classes are allowed in draft-only and checkpointed modes.
- `cavalry-api-serializers.js` prepares public response payloads.
- `cloud-readiness-interfaces.js` describes the local cloud-readiness adapter surface.
- `companion-api-audit.js` owns audit event shaping and summaries.

Server-owned behavior stays in `src/server/cavalry-api/`: HTTP routing, runtime config, auth token verification, live workbook stores, host binding, and OpenAPI serving.

Renderer/desktop-host-owned behavior stays outside this directory: UI controls, desktop bridge namespaces, IPC, provider secrets, and native runtime state.

Do not import Tauri, desktop bridges, renderer globals, provider secrets, `window`, or `document` here. Do not change API auth, scopes, checkpoint apply behavior, response shapes, audit fields, or OpenAPI-visible contracts without focused API/OpenAPI coverage.

Browser-safe modules: none are renderer-facing today; keep controller dependencies explicit and testable without direct server or Tauri imports.

Node/main/server-only modules: none in this directory; Node HTTP/runtime work belongs in `src/server/` and scripts.

Package coverage: `tests/application/cavalry-api-controller.test.js`, `tests/application/companion-mutation-gate-service.test.js`, `tests/application/companion-checkpointed-api.test.js`, `tests/server/cavalry-api.test.js`, `tests/server/companion-runtime-auth.test.js`, and `tests/openapi/cavalry-gpt-actions.test.js`. The Mac workspace retains live-app bridge coverage because that test crosses the desktop adapter boundary.
