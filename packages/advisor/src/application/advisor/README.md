# Advisor Application Services

Advisor application services coordinate deterministic Advisor workflows and browser-safe display projections.

Browser-safe display modules:

- `advisor-panel-view-model-service.js`

Provider/model calls, microphone recording, transcription, permission requests, source navigation, draft apply/reject/hide/edit behavior, active thread mutation, and desktop bridge access stay in the renderer, isolated desktop host, or dedicated workflow services with focused tests.

Do not import Tauri, Node-only modules, desktop bridges, provider clients, filesystem access, `window`, or `document` into browser-safe Advisor display services.
