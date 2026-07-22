# Architecture

Cavalry is organized as a root npm workspace. The Electron desktop app is a platform adapter and composition root; reusable business rules and workflows belong in packages. Its historical workspace path remains `apps/mac/`; packaging code supports macOS and Windows, while the current signed release channel publishes macOS only.

```text
apps/mac (Electron main, preload, renderer)
  -> advisor / companion-api / action-review / sync-foundation
    -> finance-core
```

## Workspace ownership

| Path                        | Owns                                                                                                              | Must not own                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/mac/`                 | Electron lifecycle, IPC, native files, processes, renderer, DOM/React, app packaging                              | Reusable finance rules hidden inside UI or platform handlers |
| `packages/finance-core/`    | Money, ledger, workbook schema/portability, accounts, categories, transactions, budgets, recurring items, reports | Electron, DOM, React, filesystem, network, or process APIs   |
| `packages/action-review/`   | Plans, drafts, checkpoints, conflicts, approvals, rollback                                                        | Native file access or UI effects                             |
| `packages/advisor/`         | Provider-neutral Advisor semantics, orchestration, planning, safe fallback                                        | Provider secrets, Electron IPC, or renderer code             |
| `packages/companion-api/`   | API contracts, controllers, auth, and server composition                                                          | Renderer or Electron code                                    |
| `packages/sync-foundation/` | Local sync types, changes, conflict rules, and readiness                                                          | Cloud expansion without a separate decision                  |
| `tools/`                    | Developer and optional local-model tooling                                                                        | Runtime dependencies of `finance-core`                       |
| `examples/workbooks/`       | Sanitized portable-workbook examples                                                                              | Real financial data or generated user exports                |

## Boundary rules

- Package consumers import public package entry points, never another package's internal files.
- `finance-core` is browser-safe and platform-independent.
- Node crypto, filesystem, process, Electron, HTTP transport, DOM, and React dependencies live in explicit adapters.
- Renderer features receive serializable models and callbacks. Only `apps/mac/src/renderer/platform/` adapts preload globals to renderer ports.
- Core mutations return `{ ok, workbook, events, warnings, errors }`; successful mutations return a new workbook identity.
- Navigation, rendering, persistence, notifications, and modal handling are application effects.
- `apps/mac/src/renderer/main.jsx` creates the only React root, and `app/routes.js` is the only executable route registry.
- The reducer-backed workbook session is the renderer source of truth for hydration, workbook identity, save state, route state, overlays, warnings, and errors.
- The application composition injects ports for workbook storage, browser cache, Advisor transport, Companion publishing, clock, IDs, fingerprinting, downloads, and file picking.

## Runtime flow

```text
Electron main adapters
        ↕ narrow IPC
Preload namespaces
        ↓
Renderer platform ports
        ↓
Workbook session + feature controllers
        ↓
Serializable React views
```

On launch, the session tries the native workbook adapter and then the browser cache. It renders an explicit empty, loading, or error state when no valid workbook can be hydrated. Native saves and backup recovery are main-process responsibilities; portable HTML/JSON parsing, validation, normalization, and serialization stay in `finance-core`.

## Intentional deferrals

- Cavalry Cloud provides an explicit Supabase snapshot library behind Electron ports. Automatic two-way merge remains deferred; `sync-foundation` still owns only local change/conflict primitives and is not a production transport.
- Companion API and provider-backed Advisor workflows are opt-in and cannot block the core finance workflow.
- Hosted authentication and infrastructure require separate owner decisions. Production desktop signing, notarization, and update publication are isolated in the tag-only release workflow; normal development builds remain ad-hoc and non-publishing.
- Workbook schema version 2, portable HTML/JSON compatibility, product identity, deep links, backup behavior, and user-data locations remain stable contracts.

See [ADR 0001](../adr/0001-workspace-layout-and-dependency-direction.md) for the workspace decision and [`apps/mac/README.md`](../../apps/mac/README.md) for the current app source map.
