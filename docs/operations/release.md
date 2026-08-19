# Desktop release process

Cavalry releases are native Tauri bundles with a signed updater manifest. A source build is not a production release until the application, installer, updater payload, and update metadata have passed platform certification.

## Required version agreement

The release version must match:

- root `package.json`;
- `apps/desktop/package.json`;
- root `package-lock.json` workspace entries;
- `apps/desktop/src-tauri/Cargo.toml`;
- `apps/desktop/src-tauri/tauri.conf.json`;
- `apps/desktop/src-tauri/tauri.release.template.json` metadata expectations.

Validate a tag with:

```bash
npm run release:validate -- v2.0.0
```

Tags are immutable. Never replace public files under an existing version; publish a higher fix-forward release.

## Signing inputs

Production builds require:

- Tauri updater public key in `CAVALRY_UPDATER_PUBLIC_KEY`;
- updater private key in `TAURI_SIGNING_PRIVATE_KEY` and optional password;
- Apple Developer ID certificate in `MAC_CSC_LINK`, its password in `MAC_CSC_KEY_PASSWORD`, and notarization API credentials in `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`.

The production release workflow is macOS-only. Windows development packages and CI checks remain available, but no Windows installer is signed or published by this release channel.

`apps/desktop/scripts/write-release-config.mjs` fails if the updater public key is absent and writes an ignored `tauri.release.conf.json` from the tracked template. The private key is never written into source configuration.

## Build flow

1. Check out the immutable tag.
2. Run `npm ci`.
3. Run the release, security, test, architecture, and license gates.
4. Build `dist/host/index.cjs`.
5. Build the target-specific `cavalry-host-<triple>` sidecar.
6. Generate the updater release overlay.
7. Run the pinned Tauri CLI build for the target.
8. Verify OS signatures, notarization/timestamp status, architectures, installer launch, and updater signatures.
9. Upload to a draft release.
10. Run the full native certification checklist before publishing.

## Updater transition

Installed Electron clients cannot consume a Tauri updater feed automatically. The first Tauri release therefore needs either:

- a final Electron bridge release that sends users to the Tauri installer; or
- a documented manual installation and reauthentication path.

Do not point existing Electron update metadata at Tauri bundles without a tested bridge.

## Two-version test

Use disposable macOS accounts or VMs on both Apple Silicon and Intel.

1. Install a signed baseline version and create/open a synthetic workbook.
2. Publish a higher signed draft to a test feed.
3. Confirm drafts are invisible to the public feed.
4. Publish, check, defer once, download, install, and relaunch.
5. Confirm the workbook, recents, backups, Cloud state behavior, and Advisor settings behavior.
6. Repeat with the network disabled and with an interrupted download.
7. Confirm the current version remains usable after every failure.

See [native certification](native-certification.md) for the complete matrix.
