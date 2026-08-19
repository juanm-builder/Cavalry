# AI companion capabilities

The in-app Cavalry companion discovers feature-owned tool manifests at build time. A feature that
should be available to the model adds this exact file:

```text
apps/desktop/src/renderer/features/<feature>/cavalry-assistant-capability.js
```

The file default-exports a provider created with `defineCavalryAssistantCapability`. Each tool entry
keeps its model-facing function definition, executor, approval fields, action copy, and feature
guidance together. Vite eagerly discovers the manifests; the validating registry then derives the
tool catalog, dispatch table, approval metadata, and model capability instructions. Adding a
manifest therefore requires no edit to the assistant's central schema array, handler map, or prompt.

Discovery is intentionally opt-in. A new product feature is not safe for AI use until it provides a
bounded adapter that reuses the feature's normal commands and validation boundary. Mutating tools
must declare every host-controlled approval argument. The registry rejects duplicate names, missing
handlers, unsafe approval-field names, and approval fields absent from the tool schema.

Use finance-core's canonical types and calculations in capability schemas and results instead of
copying them. The refund capability is the reference implementation: it reuses the normal
transaction command, duplicate/currency confirmation gates, ledger invariant checks, and semantic
contribution calculations.
