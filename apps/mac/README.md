# Cavalry desktop app

`@cavalry/mac` is Cavalry's Electron desktop application for macOS and Windows. The workspace name and path are retained for compatibility. Workspace dependencies are installed once at the repository root.

## Commands

Run the maintained command facade from the repository root:

```bash
npm run dev
npm run build
npm run format
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run check
npm run package:mac
npm run package:mac:intel
npm run release:validate -- v1.0.16
```

Package-specific diagnostic and certification scripts remain available with npm's workspace selector, for example:

```bash
npm run advisor:certify --workspace @cavalry/mac
npm run test:renderer --workspace @cavalry/mac
```

Generated files under `apps/mac/dist/`, `apps/mac/out/`, coverage, and test-artifact directories are not source and must remain untracked. Packaging always performs a fresh build.

## Source map

- `src/main/` — Electron lifecycle, native file access and rolling backups, IPC handlers, local-process adapters, and optional server composition.
- `src/preload/` — narrow, context-isolated namespaces that preserve the renderer IPC contract.
- `src/renderer/app/` — the reducer-backed workbook session, command/effect execution, route registry, and application composition.
- `src/renderer/features/` — feature-owned controllers, React routes, modals, and interaction behavior.
- `src/renderer/platform/` — implementations of the renderer's storage, cache, Advisor, Companion, clock, ID, fingerprint, download, and file-picker ports.
- `src/renderer/shell/` and `src/renderer/shared/` — the single application frame and shared audited UI primitives.
- `styles/` — tokens, globals, shell/shared UI, and feature-owned styling.
- `scripts/` — app-specific validation, smoke, and certification tools.
- `tests/` — app unit, integration, Electron, and fixture coverage. Repository-wide architecture tests live at `tests/architecture/`.

Reusable finance, action-review, Advisor, Companion API, and sync code lives under `packages/`. The app imports those packages through their public entry points; do not recreate package internals under `apps/mac/src/`.

## Renderer contract

`main.jsx` creates one React root. `app/routes.js` is the only executable route registry, and `WorkbookProvider` owns workbook hydration, immutable workbook identity, save state, navigation, overlays, warnings, and errors. Feature views receive serializable models and explicit callbacks; they do not access `window.cavalry*`, Electron, Node, or package internals.

Feature commands return `{ ok, workbook, events, warnings, errors }`. Successful mutations provide a new workbook identity. The application layer handles persistence, notifications, navigation, downloads, and modal state through injected ports.

## Build and packaging

Vite builds the renderer, Electron main process, and preload separately into `apps/mac/dist/`. Development uses the app's watch/HMR launcher; packaging always rebuilds and includes only `dist/`, runtime resources, and the app package manifest. `npm run package:mac` produces the existing ad-hoc Apple-silicon (`arm64`) DMG, while `npm run package:mac:intel` produces the Intel (`x64`) DMG from the same application build. There is no source-root bundle or copy-based renderer installer.

The tag-only production workflow currently publishes macOS only. It keeps the existing bundle ID and product name, requires signing/notarization for the apps and final DMG containers, and emits per-architecture DMG and ZIP files with one combined update manifest. DMG blockmaps and metadata are regenerated after the final Apple ticket is stapled so updater hashes always describe the published bytes. The separate Windows app ID, product name, NSIS configuration, and updater support remain in the repository for a future signed rollout; the current workflow does not publish Windows installers. Release configurations use a token-free public GitHub update feed. Local development and the normal ad-hoc Mac package commands never publish updates. Update checks are disabled automatically under `npm run dev`; set `CAVALRY_AUTO_UPDATE_DISABLED=1` when launching a locally packaged build that must stay offline from the release feed during QA.

Optional Advisor providers, the Companion API, Cavalry Cloud, sync readiness, and the llama.cpp launcher must remain safely disabled or degraded when unconfigured. The desktop runtime supports explicit revision-checked cloud snapshots; automatic two-way merge and hosted Companion infrastructure remain deferred. Production signing, notarization, publication, and two-version update testing are documented in [`docs/operations/release.md`](../../docs/operations/release.md).

Project documentation lives at the repository root under [`docs/`](../../docs/README.md).
