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
npm run release:validate -- v2.1.0
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
4. Build `dist/host/index.cjs` on both pinned native runners:
   - Apple Silicon on `macos-15`, whose host must report `arm64`;
   - Intel on `macos-15-intel`, whose host must report `x86_64`.
5. Build the target-specific `cavalry-host-<triple>` sidecar on its matching native host. There is no
   cross-architecture skip path.
6. Generate the updater release overlay.
7. Run the pinned Tauri CLI build for the target.
8. Verify app and DMG OS signatures, notarization/timestamp status, and architectures, then execute
   the signed packaged sidecar on its matching native host.
9. Upload both architectures serially to one draft release. The pinned Tauri action updates
   `latest.json` with a read/delete/re-upload sequence, so the release matrix permits only one
   updater-manifest writer at a time.
10. Verify the complete uploaded draft inventory and updater metadata against the GitHub release API.
11. Run the full native certification checklist and obtain second-reviewer sign-off before publishing.

## Draft asset gate

The workflow does not treat successful uploads as proof of a complete release. After both native
build jobs finish, `tools/release/verify-release-assets.mjs` reads the draft through the GitHub API
and requires exactly these seven uploaded assets for version `<version>`:

```text
Cavalry.for.Mac_<version>_aarch64.app.tar.gz
Cavalry.for.Mac_<version>_aarch64.app.tar.gz.sig
Cavalry.for.Mac_<version>_aarch64.dmg
Cavalry.for.Mac_<version>_x64.app.tar.gz
Cavalry.for.Mac_<version>_x64.app.tar.gz.sig
Cavalry.for.Mac_<version>_x64.dmg
latest.json
```

Missing, duplicate, incomplete, or unexpected assets fail the workflow. The verifier also requires
the release to remain a draft, resolves annotated tags to their commit, compares that immutable
commit with the workflow SHA, validates the version and platform map, compares each updater
signature with its uploaded `.sig`, and checks both architecture entries. GitHub updater URLs in
`latest.json` must use immutable `api.github.com/.../releases/assets/<id>` references from the same
repository and must resolve to the expected archive. Optional `-app` platform aliases are accepted
only when they exactly match their primary platform entries.

This automated inventory gate is necessary but not sufficient for publication. It does not replace
cryptographic updater-signature verification, installing the DMGs, exercising update and failure
paths, reviewing signing/notarization evidence, or testing the packaged Companion and financial
workflows.

## Publication gate

Keep the GitHub release in draft state until all blocking automated checks and every applicable item
in [native certification](native-certification.md) pass on the exact artifacts. Archive evidence
against the immutable tag and commit. A second reviewer must independently verify the inventory,
signing/notarization evidence, updater metadata, install/update behavior, and certification record.
The `release-signing` environment currently has no configured non-self reviewer, so it does not
enforce this requirement. Treat independent sign-off as an unmet publication gate until a different
reviewer performs and records it; the release author cannot self-certify this gate.

Do not publish when a required check is red, an artifact was replaced after certification, a target
has not run its signed sidecar, or a blocking checklist item lacks an approved exception. Any asset
replacement invalidates the corresponding evidence and requires the inventory verifier and affected
native certification steps to run again.

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
