# Development

## Prerequisites

- Node.js 22 and npm
- Rust stable
- package-registry access for the pinned Tauri CLI and sidecar packager
- Xcode 15 or newer, including its Command Line Tools and the macOS 14 SDK

Install the pinned native CLI with `cargo install tauri-cli --version 2.11.4 --locked`. Repository scripts then invoke it through `cargo tauri`.

## Setup

```bash
npm ci
npm run dev
```

The development command builds the Node host bundle, starts Vite, launches the Tauri application, and uses the system WebView. Development mode invokes the host bundle through the local `node` executable; packaged builds use the target-specific sidecar binary.

## Common commands

```bash
npm run format
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:integration
npm run test:e2e
npm run verify:architecture
npm run check
```

Rust host validation:

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Change ownership

- Finance rules and workbook semantics belong in `packages/finance-core`.
- Draft review and action execution belong in `packages/action-review`.
- Advisor display/orchestration contracts belong in `packages/advisor`.
- Companion API contracts belong in `packages/companion-api`.
- Native lifecycle, menus, updater, deep links, and sidecar supervision belong in `apps/desktop/src-tauri`.
- Filesystem, Cloud, Companion server, and model-process implementations belong in `apps/desktop/src/host`.
- User interaction and rendering belong in `apps/desktop/src/renderer`.

Keep changes inside the narrowest owning boundary. Do not bypass renderer ports or add a second native bridge.

## Generated files

Generated build output is ignored. Runtime dependency inventory is generated intentionally and should be refreshed when production JavaScript dependencies change:

```bash
npm run licenses:runtime
npm run licenses:runtime:check
```

A newly resolved Rust dependency graph should produce and commit `apps/desktop/src-tauri/Cargo.lock` from a network-enabled development machine before a production release.
