# Continuous integration

## Desktop CI

`.github/workflows/desktop-ci.yml` runs on pull requests and `main`.

The workspace job installs with `npm ci`, refreshes the runtime dependency inventory, runs the repository gates, integration tests, renderer smoke, architecture checks, and whitespace validation.

A separate macOS/Windows matrix runs `cargo check` against the Rust/Tauri host. Keeping this separate makes native compilation failures visible without mixing them with finance or renderer failures.

## Full native build

`.github/workflows/desktop-full.yml` is manual and scheduled. It prepares a target-specific Node sidecar, installs the pinned Tauri CLI, builds the requested Rust target, and uploads native bundle output for:

- macOS Apple Silicon;
- macOS Intel;
- Windows x64.

These artifacts are for certification and do not publish an update.

## Release

`.github/workflows/desktop-release.yml` runs only for `v*` tags. It validates version agreement, security rules, Cloud build values, tests, and generated notices before entering the protected signing environment. The production channel builds macOS Apple Silicon and Intel from the same immutable tag and uploads a draft release through the pinned Tauri action. Windows remains an unsigned CI/package target and is not published.

The release environment supplies operating-system signing material and Tauri updater keys. No private key is stored in the repository. Drafts must be inspected and certified before publication.

## Security

`.github/workflows/security.yml` runs repository secret, privacy, dependency, and release-configuration checks. Actions are pinned to immutable commits. Workflow permissions default to read-only and are elevated only for the draft-release job.
