# Settings Application Services

Settings application services prepare browser-safe JSON view models for the React settings route.

Browser-safe modules:

- `settings-route-view-model-service.js`

Renderer-owned behavior lives in `apps/desktop/src/renderer/features/settings/`: form collection, explicit callbacks, modal state, and controller commands. Native storage and Advisor/microphone operations are emitted as effects and executed through renderer ports and main-process adapters.

Do not import Tauri, Node-only modules, desktop bridges, provider calls, filesystem access, or React here. Package view-model tests live in `packages/finance-core/tests/application/`; route/controller interaction tests live in `apps/desktop/tests/renderer/`.
