# Advisor Application Services

Advisor application services coordinate deterministic Advisor workflows and browser-safe display projections.

Browser-safe display modules:

- `advisor-panel-view-model-service.js`

Provider/model calls, microphone recording, transcription, permission requests, source navigation, draft apply/reject/hide/edit behavior, active thread mutation, and preload bridge access stay in the renderer, Electron main, or dedicated workflow services with focused tests.

Do not import Electron, Node-only modules, preload bridges, provider clients, filesystem access, `window`, or `document` into browser-safe Advisor display services.
