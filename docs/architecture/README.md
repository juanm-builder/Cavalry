# Architecture

## Principles

Cavalry is local-first, finance-rule-driven, and adapter-oriented. The desktop runtime may change without changing workbook semantics, finance calculations, portable file formats, or the visible product structure.

The repository enforces these directions:

```text
apps/desktop
  ├── Rust/Tauri host
  ├── isolated Node host sidecar
  └── React renderer
        ↓
packages/advisor, action-review, companion-api, sync-foundation
        ↓
packages/finance-core
```

Lower-level packages never import the desktop application.

## Desktop boundaries

### Renderer

The renderer owns presentation and interaction. It has one React root, one route registry, and a reducer-backed workbook session. It may use browser-safe APIs and explicit platform ports, but it must not launch processes, read arbitrary files, access OS credentials, or import Node modules.

### Rust/Tauri host

Rust owns:

- application and window lifecycle;
- native menu commands;
- single-instance behavior;
- `cavalry://` deep-link delivery;
- signed updater integration and relaunch;
- target-specific bundle identities;
- launching and supervising the named Cavalry host sidecar;
- the allowlisted renderer-to-host request boundary.

Tauri capabilities grant dialog, opener, updater, and deep-link APIs to the main window. They intentionally do not grant shell or process permissions to the renderer.

### Node host sidecar

The sidecar preserves mature host services that rely on Node packages or process APIs:

- workbook open/save, recents, backups, and recovery;
- Cavalry Cloud session and snapshot operations;
- Companion API server lifecycle;
- Advisor streaming, cancellation, transcription, GGUF inspection, and llama.cpp supervision.

Rust is the only launcher. The sidecar reserves stdout for a versioned protocol and sends ordinary logs to stderr. Requests have IDs, timeouts, size limits, structured errors, and named channels.

### Native requests

When a host service needs a native picker, message box, external URL, or reveal-in-folder operation, it sends a `native-request` through Rust. The renderer executes only the allowed Tauri plugin call and returns the result through a correlated response. This avoids giving the sidecar or renderer a broad native API.

## Compatibility invariants

- Portable workbook HTML/JSON stays independent of the desktop shell.
- Existing macOS and Windows product names and identifiers are preserved by platform overlays.
- Existing app-data paths are passed to the host sidecar.
- Existing renderer routes, CSS, assets, and finance packages remain in place.
- Cloud and Advisor secrets fail closed when operating-system credential storage is unavailable.
- Old Electron-encrypted values are not downgraded to plaintext or guessed.

## Automated guardrails

`npm run verify:architecture` checks workspace direction, renderer isolation, Tauri capabilities, sidecar allowlisting, release signing configuration, generated artifacts, and the absence of Electron runtime packages.

Native compilation is a separate gate:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```
