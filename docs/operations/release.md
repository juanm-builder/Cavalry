# Desktop releases and automatic updates

Cavalry releases are built and published as drafts in this public GitHub repository. The installed app reads only public release files; no GitHub token or repository credential is embedded in an installer.

Ordinary commits and branch pushes never produce an update. Pushing an exact stable version tag builds a complete **draft** release. A maintainer must inspect that draft and click **Publish release** before any installed app can see it.

The current production channel publishes signed and notarized macOS builds for Apple silicon and Intel. Windows packaging and updater support remain implemented for a future rollout, but the current tag workflow does not build or publish Windows assets.

## Release outputs

The current release workflow builds the following signed artifacts from the same tag:

| Platform                      | First-install artifact                | Automatic-update payload            |
| ----------------------------- | ------------------------------------- | ----------------------------------- |
| macOS Apple silicon (`arm64`) | `Cavalry-for-Mac-<version>-arm64.dmg` | matching `.zip` and `.zip.blockmap` |
| macOS Intel (`x64`)           | `Cavalry-for-Mac-<version>-x64.dmg`   | matching `.zip` and `.zip.blockmap` |

The release filenames deliberately avoid spaces because GitHub normalizes spaces in uploaded asset names, which would otherwise break the generic updater URLs in `latest-mac.yml`. The metadata contains both macOS ZIP and DMG entries. They must be built in one electron-builder invocation so the metadata is merged instead of one architecture overwriting the other. After electron-builder builds the containers, the finalizer imports the release certificate into an isolated temporary keychain, signs each DMG with its Developer ID Application identity and a secure Apple timestamp, and verifies both before notarization. It then submits the final containers to Apple, staples their tickets, and regenerates the DMG blockmaps and updater hashes before verification. `SHA256SUMS.txt` lets a maintainer independently verify every uploaded file.

Windows x64 packaging remains available but dormant. When Windows signing is intentionally enabled later, it will produce `Cavalry for Windows-Setup-<version>-x64.exe`, its blockmap, and `latest.yml`; those files are not required in the current macOS release.

The normal `npm run package:mac` and `npm run package:mac:intel` commands remain ad-hoc local packages in `apps/mac/out/package/`. They do not sign, notarize, publish, or replace the production release configuration. `npm run dev` cannot check for updates because Electron reports it as unpackaged. When QA needs to launch a locally packaged build without contacting the production feed, start it with `CAVALRY_AUTO_UPDATE_DISABLED=1` in its environment.

## One-time setup

### Public GitHub repository

1. Keep the source repository public and active. Production packages derive their token-free update feed from GitHub's built-in `GITHUB_REPOSITORY` value.
2. Leave the repository's default `GITHUB_TOKEN` permission at **read-only**. The release workflow grants `contents: write` only to its final draft-release job.
3. Protect `main` and release tags such as `v*`. Require reviews and passing checks before merge, and limit who may create or update release tags.
4. Configure the workflow's `release-signing` and `release-publishing` environments with required reviewers. Store Apple signing and notarization secrets only in `release-signing`; `release-publishing` is the separate approval gate for creating or refreshing the draft. Never put release credentials in source, repository variables, release assets, or tester machines.
5. Require approval before workflows from first-time or fork contributors can run, and enable secret scanning, push protection, and private vulnerability reporting.

The update URL compiled into production packages is:

```text
https://github.com/<owner>/<repository>/releases/latest/download
```

The repository must stay public for automatic updates. Making it private would require distributing a read token to every installed app, which this design intentionally avoids.

### Cavalry Cloud release configuration

Add these GitHub Actions repository variables:

| Variable                           | Value                                        |
| ---------------------------------- | -------------------------------------------- |
| `CAVALRY_SUPABASE_URL`             | HTTPS URL of the production Supabase project |
| `CAVALRY_SUPABASE_PUBLISHABLE_KEY` | Public publishable key, or legacy `anon` JWT |

The release workflow validates these values with the same rules as the desktop
runtime before building. Never use a Supabase secret or `service_role` key. See
the [Cavalry Cloud setup guide](../features/cavalry-cloud.md) for Google OAuth,
redirect, migration, and RLS setup.

### macOS signing and notarization

Enroll in the Apple Developer Program and export a **Developer ID Application** certificate as a password-protected `.p12`. Add these Actions secrets to the protected `release-signing` environment:

| Secret                    | Value                                          |
| ------------------------- | ---------------------------------------------- |
| `MAC_CSC_LINK`            | Base64-encoded Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD`    | Password used when exporting the `.p12`        |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API key `.p8` |
| `APPLE_API_KEY_ID`        | App Store Connect key ID                       |
| `APPLE_API_ISSUER`        | App Store Connect issuer ID                    |

The workflow decodes the API key into a temporary `.p8` file and passes its path as `APPLE_API_KEY`. The release configuration requires signing, hardened runtime, notarization, and the existing entitlements. The finalizer reuses the base64 `.p12` only inside the protected signing job, deletes its isolated temporary keychain even when a signing or notarization step fails, and never logs credential values. It notarizes and staples both the app bundles used by ZIP updates and the final DMG containers used for first installation. It preserves the current `com.local.cavalry.mac` bundle ID and `Cavalry for Mac` product name. Do not change that bundle ID or signing team after testers install the first updating build unless a deliberate migration is planned.

### Future Windows signing (dormant)

These settings are not required for current macOS releases. Before enabling the Windows release job, acquire an Authenticode signing service or certificate whose private key can be used by the selected CI runner and adapt the workflow for that provider.

The retained exportable-certificate configuration expects:

| Setting                                           | Value                                                           |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Actions secret `WIN_CSC_LINK`                     | Base64-encoded `.pfx`/`.p12` certificate                        |
| Actions secret `WIN_CSC_KEY_PASSWORD`             | Certificate password                                            |
| Actions variable `CAVALRY_WINDOWS_PUBLISHER_NAME` | Publisher/common name exactly as it appears in that certificate |

Modern public-trust Windows certificates commonly keep private keys on a hardware token or HSM. Use the retained `.pfx`/`.p12` path only when the provider explicitly supports an exportable PKCS#12 private key. A cloud-signing provider requires a provider-specific workflow integration, while a USB-token certificate requires a self-hosted Windows runner.

When enabled, the Windows release will use the stable application ID `com.local.cavalry.windows` and product name `Cavalry for Windows`. Treat both as permanent once the first installer is distributed. Windows releases must require a valid signature on both the packaged application executable and the NSIS installer. electron-builder derives the update metadata's expected publisher from that certificate, and the updater verifies it before installing an update; no publisher string is interpolated into the builder config.

The existing 1024×1024 PNG is the Windows icon source. electron-builder converts supported PNG icon input to the required Windows icon formats, so a duplicate `.ico` asset is not required.

## Publishing an update

1. Choose a new version greater than every published version. Releases use stable `MAJOR.MINOR.PATCH` versions only.
2. Update the version in the root and desktop manifests and synchronize the lockfile. For example:

   ```bash
   npm version 1.0.22 --no-git-tag-version
   npm version 1.0.22 --workspace @cavalry/mac --no-git-tag-version
   npm install --package-lock-only
   ```

3. Update `CHANGELOG.md`, commit the release changes, and run the local release gates:

   ```bash
   npm ci
   npm run release:validate -- v1.0.22
   npm run release:security
   npm run check
   npm run test:integration
   npm run test:e2e
   git diff --check
   ```

4. Create and push the matching tag only after that commit is ready:

   ```bash
   git tag -a v1.0.22 -m "Cavalry v1.0.22"
   git push origin v1.0.22
   ```

5. Watch the **Desktop Release** workflow. It rejects a version that is not higher than every published stable update, reruns the gates, builds both macOS architectures in one signed/notarized invocation, verifies every macOS payload against `latest-mac.yml`, and creates or refreshes a draft release in this repository.
6. Review the draft's version, notes, complete asset list, signatures, stapled tickets, and `SHA256SUMS.txt`. Download and smoke-test both DMGs before the first public release and whenever packaging changes. Edit the user-facing release notes as needed.
7. Click **Publish release** and keep it as the latest release. That manual action is the rollout switch. The public `releases/latest/download` endpoint changes only after publication, and installed apps will then discover the new metadata.

The workflow safely reuses an existing draft for the same immutable tag when rerunning that tag's existing source and workflow, and overwrites only its generated asset names. It refuses to alter a release that is already public. If a correction requires source or workflow code that is absent from the tag, create a new release commit and higher version instead of repairing the draft with untagged code or moving the tag.

## Tester experience

New macOS testers manually install a signed DMG once. Later signed releases update from this repository. Signed Windows installers and Windows automatic updates are not distributed through the current release channel. Packaged production apps check the public release feed; local development and unpackaged runs do not. When a newer version exists, the app offers **Update now** or **Later**. Choosing update downloads in the background while the app remains usable. After a verified download is ready, the app asks for a restart before installation.

No update, an offline check, a dismissed prompt, or a transient download failure leaves the current version running. If the operating system cannot prepare or launch a downloaded installer, Cavalry restores its normal quit behavior and optional background service, then shows a friendly failure message without exposing a raw platform error. Those states do not produce a success prompt or force the application to quit. The next app launch (or a newly published higher version) can retry. Choosing **Later** suppresses that version for the rest of the current app session.

## Testing with two versions

Use disposable macOS test accounts, VMs, or machines so production testers are not involved.

1. Publish a signed, updater-enabled baseline using a previously unused version. Install its DMG on one Apple-silicon Mac and one Intel Mac. Launch each installed copy at least once. Never reuse an existing tag or version for this baseline.
2. Make a harmless visible change, bump to a higher unused version, push the matching tag, and wait for the new draft. Confirm the draft has both DMGs, both ZIPs and blockmaps, `latest-mac.yml`, and `SHA256SUMS.txt`.
3. Before publishing the draft, relaunch every baseline installation and confirm its startup check shows no update prompt. This proves drafts are invisible.
4. Publish the draft as latest and relaunch each baseline installation so its startup check finds the update. Exercise **Later** once and confirm work is uninterrupted. Relaunch the baseline again, choose **Update now**, continue using the app during download, and restart only when prompted.
5. After restart, confirm the app reports the higher version and the existing workbook still opens and saves. Relaunch once more; being up to date should show neither an update prompt nor an error.
6. Repeat once with networking disabled during the startup check and once with an interrupted download. Restore networking, relaunch, and confirm the retry succeeds without corrupting the installed version.

macOS updates must use the same Developer ID signing identity as the installed baseline. If Windows distribution is enabled later, Windows updates must retain the same application ID and expected publisher. Auto-update behavior should be tested from installed packages, not from `npm run dev` or unpacked build directories.

## Recovery rules

- Never replace a bad public release with different files under the same version. Publish a higher fix-forward version; clients already on the bad version will otherwise have nothing newer to install.
- A draft can be refreshed by rerunning the same tagged source and workflow because clients cannot see it. A correction that is not present in that immutable tag requires a new release commit and higher version. Once public, the workflow refuses to clobber it.
- Removing the latest release can strand clients or point `releases/latest` at an older version. Prefer a higher corrective release.
- Keep the signing certificates and identities backed up and access-controlled. Losing or changing them can prevent installed clients from accepting future updates.
