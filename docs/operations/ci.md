# Continuous integration

Pull-request CI installs the root workspace with `npm ci`, runs `npm run check`, and runs the Electron smoke on macOS. Full CI builds, verifies, and launches the ad-hoc Apple-silicon app on an ARM runner and the Intel app on a native Intel runner before uploading separate architecture-labelled DMGs as workflow artifacts. Every Mach-O file in each packaged app must match its target architecture. These validation workflows run on normal branches but never publish an application update.

The **Security** workflow runs on pull requests, `main`, a weekly schedule, and manual dispatch. It checks the full Git history with Gitleaks, verifies the repository's own privacy/secret/path/workflow rules, enforces a supported Electron patch, and fails on any npm advisory. Workflow artifacts used only between jobs or for CI diagnostics expire after one day.

The **Desktop Release** workflow is intentionally separate and has only a `v*` tag trigger. Its first job requires an exact stable tag matching the root app, desktop app, and lockfile versions, rejects versions that are not higher than every published stable release in this repository, validates the public same-repository update feed, and reruns the complete workspace, integration, and Electron smoke gates.

After validation:

- One macOS job invokes electron-builder once with both `arm64` and `x64`. This is required to merge both architectures into one `latest-mac.yml`. The job requires Developer ID signing, hardened runtime, notarization, stapling, and per-file architecture checks for the app bundles, then separately signs, notarizes, staples, and verifies the final DMG containers before upload.
- The Windows packaging configuration remains in the repository for a future rollout, but no Windows release job runs in the current workflow. Enabling it later requires Authenticode credentials and restoration of Windows asset validation.
- A final job downloads the macOS build output, verifies the complete metadata-to-asset graph including every declared SHA-512 and file size, writes SHA-256 checksums, and creates or refreshes a draft release in this repository.

The release job never publishes the draft. A maintainer reviews it and uses GitHub's **Publish release** action as the rollout gate. Failed and retried workflows remain invisible to installed apps, retries clobber only the expected generated asset names, and an already published release is never modified.

Workflow permissions default to `contents: read`. Only the final draft-release job receives job-scoped `contents: write` through GitHub's short-lived built-in token; there is no cross-repository publication token. The macOS builder receives Apple signing credentials only through the protected `release-signing` environment, while `release-publishing` provides a separate approval gate for the draft. Dormant Windows packaging receives no credentials. No workflow passes a publication token into electron-builder, and every builder command explicitly uses `--publish never`.
