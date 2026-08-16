# Changelog

Notable user-visible and compatibility-relevant changes are recorded here. Release entries follow the [changelog policy](docs/development/changelog-policy.md).

## Unreleased

## 1.0.26 - 2026-08-16

- Redesigned the complete Mac interface around Cavalry's new Cerulean Vault
  visual system: warm paper surfaces, disciplined cobalt and cerulean accents,
  compact mono typography, sharper hierarchy, and clearer responsive layouts.
- Replaced the network-loaded Material Symbols font with more than 150 original,
  local inline SVG glyphs across navigation, actions, statuses, accounts, and all
  category choices. A compact ledger-mark family handles utilities while a
  coordinated stamp family gives all 42 category choices recognizable, optically
  balanced pictograms. Icons can no longer fall back to raw names such as
  `dashboard` or `receipt_long` when a font request is late or unavailable.
- Reserved green and red for financial meaning. Positive income, refunds,
  savings progress, and liability credits now read green; expenses, losses, and
  overdue values read red; zero-value states remain neutral.
- Improved navigation and modal accessibility, including complete compact-window
  route access, larger reliable click targets, preserved financial row labels for
  assistive technology, and a readable net-flow announcement.

- Rebuilt Budget as **Monthly Plan**, keeping manual spending limits, recurring
  commitments, savings targets, debt-paydown targets, and expected income as
  separate concepts instead of silently merging them into one number.
- Refined Monthly Plan after real-workbook testing: reduced the overview to four
  primary cards, shows savings and debt only when relevant, replaces the large
  Budget Usage wall with a compact status, and presents one Spending, Income,
  Savings, or Debt plan list at a time.
- Moved Monthly Plan details and the Add to Plan editor into document-level,
  viewport-safe dialogs. Overview and category drilldowns now open as wide,
  centered detail views, while the editor appears immediately without requiring
  the underlying Budget page to be scrolled into position.
- Reduced explanatory clutter by keeping the essential labels in the main view
  and placing secondary definitions under optional calculation details.
- Added calculation receipts and drilldowns for Monthly Plan totals and category
  actuals. Headline figures, category rows, and transaction details now use the
  same contribution records, date range, and base-currency rules.
- Added a central transaction-contribution model for purchases, income, merchant
  refunds, reimbursements, transfers, savings contributions, debt principal,
  debt interest or fees, opening balances, and adjustments. Merchant refunds now
  subtract from the original expense category rather than increasing spending.
- Excluded unresolved foreign-currency activity from trusted totals until an FX
  rate is available, while retaining a visible warning instead of guessing.
- Kept missing and archived Monthly Plan categories visible for repair, but
  excluded them from trusted headline totals. Partial-month custom ranges now
  exclude full-month plans and explain the scope difference.
- Reworked Bills & Subscriptions so search and table filters no longer redefine
  the headline cards. Recurring values are shown as a normalized monthly
  equivalent across weekly, biweekly, monthly, quarterly, and yearly schedules.
- Added a review-first **Find recurring charges** workflow backed by Cavalry's
  existing transaction-pattern analysis. Suggestions do not create records
  automatically; Review opens a prefilled recurring-item editor with the next
  expected due date.
- Added occurrence-first bill details, separate access to the recurring rule,
  restoration for inactive recurring items, correct per-item currency labels,
  and correct handling of a partial item whose remaining amount is exactly zero.
- Added durable `YYYY-MM` sheet identities and cross-year month creation so one
  workbook can continue beyond its original calendar year.
- Updated regression expectations for the refund, Monthly Plan, recurring,
  modal-layout, multi-year, semantic-color, and local-icon behavior.
- Migration: no workbook schema-version bump. Legacy month-index sheets receive a
  durable month key during normalization and persist it on a later save. Test
  first with a duplicate workbook.
- Known limitations: historical refunds previously recorded as ordinary income
  cannot be inferred safely and must be reviewed manually. Recurring detection
  is pattern-based and may require correction.
- Validation: formatting, runtime-license notices, lint, type checks, production
  builds, 1,734 workspace/unit/renderer tests, 262 integration tests, Electron
  smoke, release security checks, trust-critical finance verification, and
  release metadata validation are gated before packaging.
- Signing/notarization status: the local DMG is an ad-hoc development artifact.
  Distribution remains gated on the GitHub release workflow's Developer ID
  signing, Apple notarization and stapling, Gatekeeper checks, updater metadata
  verification, and manual review of the generated draft assets.

## 1.0.25 - 2026-08-13

- Reworked the in-app Assistant so it converses openly instead of answering from a
  fixed script. Every turn now carries a compact workspace snapshot (position,
  balances, current-month cash flow, top spending categories, budget status, and
  upcoming bills), so questions like "how am I doing?" are answered from real
  workbook data instead of spending tool calls rediscovering it.
- Rewrote the Assistant instructions around a plain-spoken advisor persona that
  states a reasonable assumption and continues rather than stopping to interrogate.
  Clarification is now reserved for genuine blockers and can accompany a partial
  answer instead of ending the turn.
- Assistant replies now stream as the model writes them, for both API and local
  models. A stream that an endpoint rejects transparently falls back to a buffered
  request, legacy top-level response payloads remain supported, and transient
  rate-limit or server errors are retried before surfacing.
- Confirmed actions are now described by the model using the real amounts, names,
  and dates from the tool result, falling back to the previous fixed confirmation
  text if that summary cannot be produced. Everyday replies such as "sure" or
  "sounds good" confirm a pending action, and declines cancel it cleanly.
- Added a `summarize_spending` Assistant tool that aggregates the full filtered
  transaction set by category, counterparty, account, or month with citable
  evidence, replacing page-by-page row crawling for spending questions.
- Unrecognized account, category, or counterparty names now return the closest
  matching records instead of a dead end, and conversations carry forward what
  earlier turns actually looked up.
- Replaced a misleading model-timeout message that claimed Cavalry had substituted
  a verified workbook calculation; timeouts now say plainly that the model did not
  answer and point to the connection settings.
- Added Sign in with Apple to Cavalry Cloud on Mac, including encrypted PKCE
  browser authentication, explicit Apple identity linking, provider-aware OAuth
  state, official Apple button artwork, and shared iPhone/iPad account setup.
- Added an authenticated Cloud account-deletion function that revokes a freshly
  confirmed Apple token, removes private feedback objects, and deletes the
  owner-scoped Supabase account data required by the iOS deletion flow.
- Updated Electron to 41.10.5 to pick up the current 41.x security patch, and
  resolved the outstanding advisories in `brace-expansion`, `fast-uri`,
  `js-yaml`, `nanoid`, and `undici`. No application behavior changed.
- Known limitation: Assistant streaming is covered by transport and runtime tests
  but has not yet been exercised against every supported live API or local-model
  endpoint. Endpoints that reject streaming fall back to buffered responses.
- Validation: formatting, runtime-license notices, lint, type checks, production
  builds, 1,870 workspace/unit/renderer tests, 252 integration tests, Electron
  smoke, release security checks, and release validation are gated before
  packaging.
- Signing/notarization status: distribution remains gated on Developer ID
  signing with a secure timestamp, Apple notarization and stapling, Gatekeeper,
  architecture checks, updater metadata verification, and manual review of the
  generated GitHub draft assets.

## 1.0.24 - 2026-07-29

- Added a **Notes** workspace that turns plain-language entries into a reviewable
  transaction batch, with deterministic parsing, optional Assistant enrichment,
  duplicate protection, account and category resolution, currency handling, and
  all-or-nothing ledger validation.
- Added **Create new category** directly to category dropdowns across budgets,
  transactions, recurring items, and draft review. New categories are selected
  automatically, and budget creation supports expense, savings, and debt types
  without discarding in-progress work.
- Added a persistent transaction search beside Filters that composes with the
  existing date, account, category, type, status, and amount filters and searches
  descriptions, notes, counterparties, categories, accounts, and amounts.
- Hardened the local Assistant lifecycle so Start and Test are single-flight,
  Stop waits for confirmed termination and escalates safely when required, stale
  process identities are rejected, and failed starts no longer leave misleading
  running state behind.
- Added bounded GGUF metadata validation for local text models and optional vision
  projectors. Cavalry now rejects corrupt, role-swapped, or dimensionally
  incompatible files before launching `llama-server` and reports concise,
  actionable errors instead of native backtraces.
- Improved transaction understanding for both API and local Assistant providers:
  omitted dates default to today, explicit user wording wins over conflicting
  model output, saved rules and transaction history improve categorization, and
  account, counterparty, negation, and incidental-context handling avoid
  unnecessary follow-up questions and dangling references.
- Refreshed the release toolchain and patched transitive archive and stylesheet
  dependencies. The remaining upstream glob-expansion advisory is restricted to
  development-only tools by a precise, expiring exception while the release gate
  continues to require zero production dependency advisories.
- Fixed deterministic workbook revision conflicts being reported as retryable
  PostgreSQL serialization failures, which could cause PostgREST to generate a
  sustained database retry storm from a single stale Cloud upload.
- Cavalry Cloud now refreshes workbook metadata after a revision conflict and
  rejects overlapping workbook operations. A newer Cloud copy is latched for
  explicit review across restarts and sign-ins instead of becoming the base for
  a second upload; a deleted Cloud copy can be added again without automatically
  overwriting either copy.
- Migration: deploy `20260726000100_fix_workbook_conflict_retry.sql` to the
  Cavalry Supabase project.
- Known limitation: image intake for a local multimodal model still requires a
  vision projector from the exact same model family and embedding size. Text-only
  local Assistant use does not require a projector.
- Validation: formatting, runtime-license notices, lint, type checks, production
  builds, workspace/unit/renderer/integration tests, Electron smoke, migration
  checks, release security checks, and release validation are gated before
  packaging.
- Signing/notarization status: distribution remains gated on Developer ID
  signing with a secure timestamp, Apple notarization and stapling, Gatekeeper,
  architecture checks, updater metadata verification, and manual review of the
  generated GitHub draft assets.

## 1.0.23 - 2026-07-24

- Added private, cross-device feedback and bug reports for signed-in Cavalry Cloud users, with an optional PNG or JPEG screenshot and an owner-visible report history in Settings.
- Added an unobtrusive **Report a problem** flow inside the Cavalry AI companion so a report can carry the current app section as context without adding another dashboard surface.
- Kept Supabase sessions, tokens, private object paths, and network calls in Electron main behind trusted, narrowly scoped IPC; owner-bound request keys make lost responses safely retryable, while account changes invalidate private results and clear unsent descriptions and images.
- Added owner-scoped report and attachment quotas, forced RLS, RPC-only report creation/finalization, and operation-aware policies for a private `feedback-attachments` bucket. No service-role secret or durable image bytes are exposed to the renderer.
- Migration: deploy `20260724000100_cloud_feedback.sql` to the Cavalry Supabase project before publishing or enabling this desktop version. Existing workbook files and Cloud snapshots require no migration.
- Known limitation: feedback submission is available only to signed-in Cavalry Cloud users. Signed-out or Cloud-unavailable reports are not sent, queued locally, or presented as cross-device synced.
- Validation: formatting, runtime-license notices, lint, type checks, production builds, workspace/unit/renderer/integration tests, Electron smoke, migration/RLS checks, release security/history checks, dependency advisories, and release validation are gated before packaging.
- Signing/notarization status: distribution remains gated on Developer ID signing with a secure timestamp, Apple notarization and stapling, Gatekeeper, architecture checks, updater metadata verification, and an installed `1.0.22` to `1.0.23` automatic-update test.

## 1.0.22 - 2026-07-23

- Deferred secure credential access during ordinary startup so fresh or signed-out profiles and Advisor setups without a stored key no longer unexpectedly request macOS Keychain access; existing encrypted Cloud sessions still restore automatically, and secure storage initializes when stored credentials exist or the user explicitly starts sign-in.
- Preserved the user's independently selected list or grid view when navigating away from and back to the Accounts and Categories sections.
- Migration: none. Existing workbook files and encrypted Cloud sessions require no migration.
- Known limitation: macOS may still show its system Keychain authorization dialog when a user first enables a feature that stores credentials securely; Cavalry does not receive the user's macOS password.
- Validation: formatting, runtime-license notices, lint, type checks, production builds, unit/renderer/integration tests, Electron smoke, security/history checks, dependency advisories, and release validation are gated before packaging.
- Signing/notarization status: distribution remains gated on Developer ID signing with a secure timestamp, Apple notarization and stapling, Gatekeeper, architecture checks, updater metadata verification, and an installed `1.0.21` to `1.0.22` automatic-update test.

## 1.0.21 - 2026-07-23

- Hardened macOS release packaging so the final DMG containers are Developer ID-signed with a secure timestamp, Apple-notarized, and stapled; their blockmaps and updater hashes are regenerated before upload.
- Added fail-closed release verification for the exact Apple-silicon and Intel asset inventory, updater hashes and sizes, legacy metadata, and platform-independent blockmap contents.
- Isolated the release certificate in a temporary keychain that is removed after signing, including when certificate import or notarization fails.
- Migration: none. Existing workbook files require no migration.
- Known limitation: this is intended to become the first public updater baseline, so automatic updating can be proven only after a higher `1.0.22` release is published.
- Validation: formatting, runtime-license notices, lint, type checks, production builds, unit/renderer/integration tests, Electron smoke, security/history checks, dependency advisories, and release-asset verification are gated before packaging.
- Signing/notarization status: distribution remains gated on Developer ID signing with a secure timestamp, Apple notarization and stapling, Gatekeeper, architecture checks, updater metadata verification, and independent testing of both final DMGs.

## 1.0.20 - 2026-07-23 (Unpublished release candidate)

- Prepared the source tree for public review with an Apache-2.0 license, contribution and conduct guidance, private security reporting, privacy/support documentation, and packaged third-party notices.
- Added release-time security and repository hygiene checks, tightened resource retention, and documented same-repository public update publishing.
- Fixed CI package builds so they remain artifact-only, preserved license coverage for workspace-nested dependencies, and refreshed compatible dependency patches.
- Removed stale internal planning archives and private-history revision references while retaining user-facing release history.
- Migration: none. Existing workbook files require no migration.
- Publication status: this candidate was not published or distributed. Independent draft verification confirmed the embedded apps but found that the outer DMG containers were not separately signed, notarized, or stapled.
- Known limitation: a later version will become the first public updater baseline, and automatic updating can be proven only with a subsequent higher release.
- Validation: formatting, runtime-license notices, lint, type checks, production builds, unit/renderer/integration tests, Electron smoke, security/history checks, and dependency advisories are gated before packaging.
- Signing/notarization status: the embedded apps passed Developer ID signing, Apple notarization and stapling, Gatekeeper, and architecture checks. Publication was withheld because the final DMG containers did not meet the same outer-container gate.

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
