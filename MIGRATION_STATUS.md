# Tauri migration status

## Implemented in this repository

- Electron application shell removed from source and dependency manifests.
- Desktop workspace renamed to `@cavalry/desktop` under `apps/desktop`.
- React renderer and existing styling retained.
- Rust/Tauri 2 host added with native menu, window lifecycle, single-instance handling, deep links, updater, and relaunch.
- Versioned renderer ↔ Rust ↔ Node sidecar protocol added.
- Workbook, iCloud, Companion API, Advisor, microphone, and llama.cpp host services retained behind the sidecar boundary.
- Keychain-backed credential envelope added.
- Mac identity and shared CloudKit entitlements added.
- Tauri CI and full-build workflows cover Apple Silicon and Intel Mac, with a signed Mac release workflow.
- Repository architecture, security, release, and documentation guardrails updated.

## Verified in the packaging environment

- JavaScript syntax checks for new host, renderer bridge, release, and repository tools.
- Tauri JSON, Cargo TOML, workflow YAML, package manifest, and lockfile structural checks.
- Repository architecture verification and source-boundary report.
- Absence of Electron runtime packages and source imports.
- Clean source-archive integrity and forbidden-path scan.

## Still required on a network-enabled native machine

- `npm ci` using the package registry.
- generation and review of `apps/desktop/src-tauri/Cargo.lock`.
- `cargo fmt`, `cargo check`, and native Tauri compilation.
- target-specific sidecar packaging.
- complete unit, interaction, integration, and native smoke suites.
- macOS WKWebView certification for Apple Silicon and Intel release targets.
- macOS code signing, notarization/timestamping, updater signing, and two-version update tests.
- measured installer size, startup time, and idle memory.

The repository is prepared for those gates but this source ZIP is not a compiled or signed application installer.
