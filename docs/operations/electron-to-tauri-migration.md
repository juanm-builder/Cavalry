# Electron-to-Tauri migration runbook

## Preserved

- React routes, components, CSS, imagery, and interaction structure
- finance packages and workbook commands
- portable workbook file format
- recent-workbook, backup, and recovery locations
- Companion API and Advisor contracts
- `cavalry://` callback scheme
- the Mac product identity and local application-data location

## Changed

- Chromium/Electron application shell becomes Tauri using WKWebView on macOS.
- Electron IPC/preload namespaces become a Tauri renderer bridge, Rust command boundary, and versioned sidecar protocol.
- `electron-updater` becomes the signed Tauri updater.
- Electron menu/window lifecycle becomes Rust/Tauri menu and lifecycle handling.
- `safeStorage` becomes AES-256-GCM with a Keychain-protected master key.

## User-data transition

The Rust host passes the previous application-data directory to the sidecar. Workbook recents, backups, and recovery metadata therefore remain at their established location.

Old `safeStorage` ciphertext is intentionally not decrypted by Rust or written as plaintext. Users may need to re-enter encrypted Advisor credentials. iCloud access follows the system Apple Account and has no Cavalry session token to migrate.

## Installed-client transition

Electron clients cannot interpret a Tauri updater manifest. Choose and test one transition:

1. Publish a final Electron release that detects the Tauri transition, explains reauthentication, and opens the signed Tauri installer; or
2. publish the Tauri installer separately and provide a manual migration guide.

Never replace the Electron feed in place and assume automatic crossover.

## Certification blockers

Do not publish until the native checklist passes for workbook IO, deep links, OAuth, microphone, downloads, updater, keyboard/focus, accessibility, and both published macOS architectures.
