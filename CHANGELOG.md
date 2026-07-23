# Changelog

Notable user-visible and compatibility-relevant changes are recorded here. Release entries follow the [changelog policy](docs/development/changelog-policy.md).

## Unreleased

## 1.0.20 - 2026-07-23

- Prepared the source tree for public review with an Apache-2.0 license, contribution and conduct guidance, private security reporting, privacy/support documentation, and packaged third-party notices.
- Added release-time security and repository hygiene checks, tightened resource retention, and documented same-repository public update publishing.
- Fixed CI package builds so they remain artifact-only, preserved license coverage for workspace-nested dependencies, and refreshed compatible dependency patches.
- Removed stale internal planning archives and private-history revision references while retaining user-facing release history.
- Migration: none. Existing workbook files require no migration.
- Known limitation: this is the first signed public updater baseline, so automatic updating can be proven only after a later `1.0.21` release is published.
- Validation: formatting, runtime-license notices, lint, type checks, production builds, unit/renderer/integration tests, Electron smoke, security/history checks, and dependency advisories are gated before packaging.
- Signing/notarization status: distribution is gated on Developer ID signing, Apple notarization and stapling, architecture checks, and updater metadata verification for the final `v1.0.20` artifacts.

## 1.0.19 - 2026-07-21

- Added a native **Check for Updates…** command so installed builds can check immediately instead of waiting for the next scheduled check.
- Added a persistent sidebar update indicator with download progress, retry visibility, and a restart action after an update is ready.
- Kept scheduled update checks quiet when the app is current or offline, while manual checks provide clear, friendly feedback; updater controls remain inactive during local development.
- Known limitation: the new in-app update indicator ships in this version, so users updating from an older version see it only after 1.0.19 is installed.
- Validation: formatting, lint, type checks, production builds, workspace/unit/renderer tests, release integration tests, and Electron DOM smoke passed before packaging.
- Signing/notarization status: distribution is gated on Developer ID signing, Apple notarization and stapling, architecture checks, and updater metadata verification for the final `v1.0.19` artifacts.

## 1.0.18 - 2026-07-21 (Cavalry Cloud beta)

- Added Cavalry Cloud sign-in with Google, a multi-workbook cloud library, explicit **Add to Cloud** and **Sync Now** actions, revision-checked snapshots, open/download, profile editing, and confirmed cloud deletion. Local workbooks remain usable and are never uploaded automatically.
- Added encrypted Cloud-session persistence in the macOS keychain, main-process-only OAuth credentials, strict callback and IPC validation, and owner-scoped Supabase Row Level Security.
- Added a recent-workbook library, workbook renaming, and startup/settings refinements for working with multiple local and cloud workbooks.
- Moved stored Advisor API keys behind operating-system encryption and kept unconfigured or offline Advisor and Cloud features safely degraded.
- Hardened the macOS updater release contract with GitHub-safe hyphenated asset names, complete differential-download asset checks, consistent legacy metadata validation, and a patched production YAML parser dependency.
- Migration: deploy both `20260720000100_cavalry_cloud.sql` and `20260720000200_fix_cloud_first_save.sql`, enable the Google provider, and configure the exact `cavalry://auth/callback` redirect before enabling Cloud for testers. Existing workbook files require no migration.
- Known limitation: Cloud sync is explicit and snapshot-based. It does not automatically merge changes from two devices; stale uploads stop with a revision conflict so financial changes are not silently overwritten.
- Validation: formatting, lint, type checks, production builds, workspace/unit/renderer tests, release integration tests, Electron DOM smoke, Cloud migration/security checks, and the production dependency audit passed before packaging.
- Signing/notarization status: distribution is gated on Developer ID signing, Apple notarization and stapling, architecture checks, updater metadata verification, and a two-version install/update test for the final `v1.0.18` artifacts.

## 1.0.17 - 2026-07-18 (First beta)

- Reorganized Cavalry into an npm workspace with the Mac app, finance core, action review, Advisor, Companion API, sync foundation, and developer tools in explicit owning modules.
- Replaced the legacy renderer and compatibility mounts with one React root, one route registry, reducer-backed workbook state, feature controllers, and explicit platform ports.
- Split the renderer, Electron main process, and preload into independent Vite builds under `apps/mac/dist/`; packaging now consumes built output only.
- Preserved schema-v2 portable HTML/JSON workbooks, ledger semantics, native rolling backups, product identity, deep links, and existing preload namespaces.
- Added macOS Electron smoke coverage, architecture boundary checks, and package-level validation.
- Added a separate Intel (`x64`) macOS package and native Intel CI validation while preserving the existing Apple-silicon (`arm64`) package.
- Enhanced Cavalry Assistant answers with evidence references, linked citations, richer Markdown rendering, clearer tool output, and a resizable chat panel.
- Added recurring bill payment reconciliation so matching transactions and bill state stay synchronized.
- Fixed local calendar-date handling so transaction dates do not shift across time zones when saved or edited.
- Added a notarized Apple-silicon and Intel macOS release channel with opt-in background updates, restart/install prompts, and a tag-to-draft GitHub publication gate; Windows packaging support remains dormant for a future rollout.
