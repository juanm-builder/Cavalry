# Cavalry desktop application

`@cavalry/desktop` is the Tauri 2 desktop workspace for macOS and Windows. It keeps Cavalry's existing React interface and workbook behavior while replacing Electron's application shell with a Rust/Tauri host.

## Runtime map

- `src/renderer/` — React application, routes, features, shared UI, and renderer platform ports.
- `src/renderer/platform/tauri-*.js` — Tauri event, command, update, dialog, opener, and deep-link adapters.
- `src/host/` — isolated Node services for workbooks, Cloud, Companion API, Advisor, and local-process supervision.
- `src/host/runtime/` — sidecar protocol, router, native-request bridge, and host composition.
- `src-tauri/` — Rust host, capabilities, platform overlays, icons, bundle configuration, and updater template.
- `styles/` — existing tokens, layout, shell, shared, and feature styles.
- `scripts/` — sidecar preparation, smoke checks, release overlay generation, and app certification tools.
- `tests/` — application, host, renderer, and native-boundary tests.

The renderer does not receive Node, shell, process, or unrestricted filesystem access. It invokes one Rust-owned command boundary, and Rust forwards only approved `cavalry-*` channels to the sidecar.

## Commands

From the repository root:

```bash
npm run dev
npm run build
npm run test
npm run test:integration
npm run test:e2e
npm run verify:architecture
```

Workspace-specific commands:

```bash
npm run test:renderer --workspace @cavalry/desktop
npm run advisor:certify --workspace @cavalry/desktop
npm run tauri:doctor --workspace @cavalry/desktop
```

Native package commands:

```bash
npm run package:mac
npm run package:mac:intel
npm run package:windows
```

## Toolchain

Install Node dependencies at the repository root with `npm ci`, install the current stable Rust toolchain, and install the pinned Tauri CLI with `cargo install tauri-cli --version 2.11.4 --locked`.

Sidecars are produced with `@yao-pkg/pkg@6.22.0` through `scripts/build-sidecar.mjs`. The script writes only the target-specific binary expected by Tauri and rejects missing or suspiciously small output.

## Renderer and design parity

`main.jsx` still creates one React root. `app/routes.js` remains the executable route registry, and `WorkbookProvider` continues to own hydration, immutable workbook identity, persistence state, navigation, overlays, warnings, and errors. Existing CSS and image assets are preserved.

The system WebView can differ subtly from Chromium. Before a release, certify layout, keyboard focus, downloads, IndexedDB, microphone capture, accessibility, and platform font rendering on both WKWebView and WebView2. The maintained checklist is in [`docs/operations/native-certification.md`](../../docs/operations/native-certification.md).

## Data compatibility

Workbook files, recents, recovery files, and rolling backups keep their existing format and application-data locations. The Rust host passes the legacy data directory to the sidecar so existing local workbooks remain discoverable.

Electron `safeStorage` ciphertext is not automatically decryptable by the new host. The migration therefore fails closed and may require the user to sign in to Cavalry Cloud again or re-enter encrypted Advisor credentials. See the [migration runbook](../../docs/operations/electron-to-tauri-migration.md).

## Generated output

Do not commit:

- `dist/`
- `src-tauri/target/`
- `src-tauri/gen/`
- generated `src-tauri/binaries/cavalry-host-*`
- generated `src-tauri/tauri.release.conf.json`
- packaged applications, installers, updater artifacts, logs, coverage, or test artifacts
