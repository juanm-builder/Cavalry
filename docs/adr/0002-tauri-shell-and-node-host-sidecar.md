# ADR 0002: Tauri shell with isolated Cavalry host sidecar

- Status: Accepted
- Date: 2026-08-19

## Context

Cavalry's Electron host had mature workbook recovery, Cloud, Companion API, Advisor streaming, transcription, GGUF inspection, and llama.cpp supervision. Rewriting all of those services in Rust in one release would create a large regression surface. Keeping Electron would continue shipping a bundled Chromium runtime and retain higher distribution overhead.

## Decision

Replace Electron with Tauri 2 for the application shell and retain the existing Node host services as a target-specific, tightly scoped sidecar.

Rust owns native lifecycle, menus, deep links, updater, window state, process launch, and the renderer command boundary. The renderer remains browser-only. The sidecar uses a versioned protocol over stdin/stdout and has no direct renderer access.

This is a production migration architecture, not permission for arbitrary sidecars. Only `cavalry-host` is bundled and launchable.

## Consequences

- The React interface and finance behavior can remain stable.
- Distribution no longer bundles Electron or Chromium.
- Native behavior must be certified against WKWebView on both supported Mac architectures.
- Node is still present inside the packaged sidecar, so further Rust migration may reduce size and complexity later.
- Electron `safeStorage` values require reauthentication or a dedicated one-time migration tool.
- Existing Electron clients need a bridge or manual installer path to move onto the Tauri update feed.
