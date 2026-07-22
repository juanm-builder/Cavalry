# AI Provider Application Services

AI provider services define the local Advisor provider interface and tool registry used by Advisor workflows.

Files:

- `advisor-provider-interface.js` defines provider response shapes and validation helpers.
- `advisor-tool-registry.js` defines the tool registration surface used by Advisor provider integrations.
- `local-rules-advisor-provider.js` implements the deterministic local rules provider used for safe fallback and tests.

Renderer-owned behavior lives in `apps/mac/src/renderer/features/advisor/`: chat UI, active thread and composer state, source navigation, and explicit user actions. The controller receives Advisor transport through an injected renderer port.

Electron/main-owned behavior stays in `apps/mac/src/main/`: provider endpoint settings, local model process boundaries, transcription, microphone permission checks, secrets, and privileged IPC.

Do not import Electron, Node-only modules, preload bridges, filesystem access, provider secrets, `window`, or `document` here. Do not change provider contracts, model-call shapes, trust gates, prompt construction, or tool execution behavior without Advisor parity coverage.

Browser-safe modules:

- `advisor-provider-interface.js`
- `advisor-tool-registry.js`
- `local-rules-advisor-provider.js`

Node/main/server-only modules: none in this directory.

Package coverage: `tests/application/in-app-advisor-foundation.test.js` and `tests/application/in-app-advisor-safety.test.js`. Run it with `npm test --workspace @cavalry/advisor`; provider-process and renderer certification remain in the Mac workspace.
