# Changelog

Notable user-visible and compatibility-relevant changes are recorded here. Release entries follow the [changelog policy](docs/development/changelog-policy.md).

## 2.2.10 - 2026-09-06

### Added

- Mac users can choose the iCloud account for Cavalry in an Apple browser sign-in window,
  independently of the Apple Account used by macOS. Account & sync shows the selected source and
  actual account reference, with separate Change account, Pause/Resume, and Sign out controls.
- Local recovery can discover retained copies across account-specific caches. Recovered workbooks
  open as separate local copies with iCloud autosave off.

### Fixed

- Pending uploads, saved sessions, caches, and delayed sync responses remain tied to their verified
  iCloud account. Changing accounts does not automatically upload existing workbooks to the newly
  selected library, and signing out keeps local workbooks.
- Apple browser sign-in correctly receives the CloudKit callback. Updated sign-in pages and scripts
  use explicit versions so a browser cache cannot retain an older callback implementation.
- Both Mac release architectures include the verified browser sign-in configuration. Packaged
  startup checks reject builds where that configuration is missing.

### Compatibility and draft release notes

- This candidate retains the workbook format, Production CloudKit container, and durable local
  recovery introduced in 2.2.9. It does not move data between Apple Accounts or retrieve workbooks
  from the former Cavalry Cloud service.
- Live browser authentication and the returned CloudKit account identity have been verified. The
  signed local ARM64 candidate passed startup, embedded-configuration, and crash/relaunch recovery
  checks. Signing, notarization, and validation evidence for the final two-architecture artifacts
  belong to the immutable GitHub draft release record.
- Keep this release in draft while real Mac–iPhone workbook sync, account-switch isolation, and
  installer/update certification remain pending. The originally reported missing workbook has not
  been recovered.

## 2.2.9 - 2026-09-05

### Added

- Workbooks now have a durable library on the Mac, outside the application and its WebView cache,
  with up to 30 distinct recent saved copies per workbook. Saved workbooks remain discoverable in
  Recent workbooks even when the selected-workbook pointer or an exported file is unavailable.
- Startup validates saved copies and can recover an earlier verified copy when the latest copy is
  damaged. An older recovered version opens as a separate **(Recovered)** workbook with iCloud
  autosave off; recovery errors remain visible and original copies are retained.
- Readable snapshots from the older local Production iCloud cache are discoverable for explicit
  recovery. Opening one creates a separate local copy without modifying the old cache or cloud copy.
- Added [workbook storage and recovery guidance](docs/features/workbook-recovery.md), including
  where to find iCloud workbooks and how to export an independent file.

### Fixed

- Updating, quitting, and reloading now wait for the latest workbook save. A failed save keeps
  Cavalry open and explains the problem; updates save again after installation before restarting.
- Local save success now requires a durable Mac copy, including workbooks without an exported file.
- Recovery saves record their version order explicitly. A clock correction or restored file timestamp
  cannot cause retention cleanup to delete the newest acknowledged save or reopen an older version.
- CloudKit writes use separate payload files and atomic state commits, preserving the previous
  payload while a newer save is being committed. Failed local sync-state writes are reported.
- Development iCloud libraries are explicitly identified as test libraries, and production mobile
  build profiles reject a Development environment override.

### Compatibility and release notes

- Version 2.2.8 remained an unpublished draft after a final recovery ordering check found a defect.
  Version 2.2.9 includes the correction and is the first published release of these recovery changes.
- Existing workbook IDs, portable HTML files, and the shared CloudKit container remain compatible.
  Saved local data is adopted without requiring a new workbook or a new iCloud account. Retained
  history starts as this version saves workbooks; it cannot recreate data absent from every copy.
- iCloud workbooks are opened inside Cavalry. They are private CloudKit records and do not appear
  as files in iCloud Drive unless the user exports a copy there.
- Signed Mac 2.2.7 and iOS 1.0.0 (17) artifacts were verified to use the same Production environment,
  container, and Apple team. The reported differing account references have not been reproduced on
  the affected devices; this release adds accurate environment diagnostics without inventing a
  shared account reference.
- The matching iPhone update is 1.0.1 through TestFlight, with explicit startup recovery and the
  latest 10 distinct saved versions per workbook. Final signing, artifact certification, source
  commit, and validation evidence belong to the immutable GitHub release record.

## 2.2.5 - 2026-08-31

### Added

- Redesigned iCloud settings into one coherent surface that separates Apple Account availability,
  the current local workbook, and the confirmed iCloud workbook library.
- Added accurate confirmed-versus-waiting counts, scoped error details, and target-specific retry
  actions for adding, opening, updating, and removing iCloud workbooks.

### Fixed

- Fixed item-level CloudKit failures being hidden behind a generic partial-failure message, including
  actionable Production database/schema guidance without risking the local workbook.
- Fixed queued creates being counted as confirmed iCloud workbooks while preserving confirmed counts
  for queued updates to an existing cloud copy.
- Fixed stale or cross-workbook sync errors, stuck change-tag retries, false success after terminal
  conflict/delete failures, and malformed remote records disappearing without an explanation.

### Compatibility and release notes

- Existing Mac workbooks remain stored locally and unchanged. Development CloudKit records are not
  copied into Production; the current local workbook can be added again after Production is ready.
- Production iCloud writes require the complete `CavalryWorkbook` schema to be deployed in the shared
  CloudKit container. Cavalry now preserves the local workbook and offers an explicit retry after an
  administrator completes that deployment.
- The matching iPhone redesign and error handling are distributed separately through TestFlight.

## 2.2.4 - 2026-08-30

### Added

- Added explicit **Add to iCloud** and **Remove from iCloud** controls for Mac workbooks. Removing
  an iCloud copy always keeps the workbook stored on the Mac, and Cavalry will not upload it again
  until the user deliberately adds it back.
- Added clear conflict actions—**Use Mac Version** and **Use iCloud Version**—with confirmations
  that explain which copy will be kept.

### Fixed

- Fixed production CloudKit state accidentally reusing development sync anchors, which could show
  a phantom **Needs Review** state even when the production iCloud library was empty.
- Fixed review and Mac-version recovery when the local CloudKit cache is incomplete by checking the
  exact private record before reporting that an iCloud copy is unavailable.
- Fixed same-revision CloudKit change-tag races and idempotent deletion, including interrupted
  uploads, empty local caches, offline queued removal, and terminal delete failures.

### Compatibility and release notes

- Existing Mac workbooks remain local and unchanged. Development and production CloudKit engine
  state are now isolated; no workbook schema migration is required.
- Cavalry for iPhone receives its matching settings-navigation and iCloud-library controls through
  TestFlight rather than this Mac GitHub release.

## 2.2.3 - 2026-08-30

### Fixed

- Fixed post-signing verification so Cavalry's sidecar signing wrapper applies its dedicated JIT
  entitlements only during signing, then leaves read-only signature inspection to Apple's system
  `codesign` tool. This preserves the strict sidecar entitlement check without redirecting its
  output.

### Compatibility and release notes

- This fix-forward release supersedes the unpublished `v2.2.2` build attempt. The signed Apple
  Silicon app, host-sidecar execution, and Apple notarization had already passed; this change fixes
  only the subsequent verification command.

## 2.2.2 - 2026-08-30

### Fixed

- Fixed Mac release-profile validation to recognize Apple's wildcard authorization for registered
  iCloud services in Xcode-generated Developer ID profiles. The final signed app is still required
  to request CloudKit explicitly and only the production Cavalry container.

### Compatibility and release notes

- This fix-forward release supersedes the unpublished `v2.2.1` build attempt. There are no further
  application, workbook, sync, or interface changes.

## 2.2.1 - 2026-08-30

### Fixed

- Fixed the Developer ID release pipeline so it can use a locally generated, encrypted Mac direct
  distribution profile when the notarization API key is not permitted to manage certificates and
  profiles. The workflow still validates the profile's app identity, distribution scope,
  production CloudKit environment, shared container, and CloudKit service before signing.

### Compatibility and release notes

- This fix-forward release supersedes the unpublished `v2.2.0` build attempt and includes the full
  Apple-native, local-first feature set documented below. It does not change workbook data or
  require a migration.
- GitHub release artifacts remain drafts until both Mac architectures pass Developer ID signing,
  sidecar execution, notarization, stapling, updater-signature, and release-inventory checks.

## 2.2.0 - 2026-08-30

### Added

- Added private, local-first CloudKit synchronization between Cavalry for Mac and Cavalry for
  iPhone through `iCloud.com.juanmbuilder.cavalry`. Each device keeps a complete local workbook,
  saves immediately while offline, and exchanges only queued changes when a connection returns.
- Added automatic CloudKit change notifications, incremental fetches, retry scheduling, honest
  connection states, and a manual Sync Now action without a permanent polling loop.
- Added transaction-focused conflict review on both Mac and iPhone. Cavalry shows the specific
  values that disagree, lets the user choose what every device should keep, and synchronizes the
  resolved workbook back through iCloud.
- Added automatic merging for safe concurrent changes and internal workbook metadata so users are
  asked only about meaningful financial disagreements.
- Added iPhone workbook import, quick add, transaction detail and editing, adaptive navigation,
  protected local storage, and the shared finance engine used by Cavalry for Mac.

### Changed

- Changed the Mac application identity to `com.juanmbuilder.cavalry.mac`; the paired iPhone app uses
  `com.juanmbuilder.cavalry.ios`. Both identities share the same private CloudKit container.
- Simplified the iCloud and settings interfaces on both platforms while preserving Cavalry's
  existing typography, spacing, controls, and overall visual language.
- Kept HTML workbooks as portable local files and exports while making structured local data plus
  CloudKit records the source of truth for continuous synchronization.
- Updated the Mac release pipeline to verify production CloudKit entitlements, provisioning,
  signed sidecar behavior, notarization, updater signatures, and complete dual-architecture assets.

### Fixed

- Fixed offline edits that previously stalled after reconnecting when both devices changed the same
  workbook. Independent additions are preserved, deletion and edit conflicts stop for review, and
  successful resolutions can be completed from either device.
- Fixed vague or irrelevant conflict choices such as settings timestamps and whole-workbook counts.
  Legacy conflict notices are recalculated into concise transaction, account, category, bill,
  budget, or note decisions before they are shown.
- Fixed iPhone library refresh and workbook validation paths so Mac workbooks can be discovered,
  downloaded, opened, edited, and synchronized in both directions.
- Fixed the Mac resolution action so a completed set of choices is durably applied and uploaded
  instead of leaving the confirmation button with no effect.

### Security

- Removed hosted service credentials, environment-variable plumbing, authentication callbacks, and
  network code that are no longer required by the private CloudKit architecture.
- Hardened production entitlements and release checks so both apps use only the intended bundle ID,
  production APNs environment, and shared CloudKit container.
- Disabled iOS document sharing and unused biometric permission prompts, removed unnecessary direct
  dependencies and assets, and retained only the network and storage capabilities Cavalry uses.

### Removed

- Removed Supabase code, dependencies, configuration, environment examples, API integration,
  schemas, functions, migration scripts, and hosted feedback surfaces. No Supabase data migration is
  included because Cavalry had no hosted data to preserve.
- Removed Windows source conditionals, build targets, packaging, icons, CI paths, and documentation.
- Removed the obsolete hosted-account sign-in experience, orphaned renderer code, unused iOS
  packages, and unreferenced platform assets.

## 2.1.2 - 2026-08-27

### Fixed

- Production Mac builds now compile the validated legacy Cloud project URL and publishable key into
  the isolated desktop host, restoring Cavalry Cloud, Google sign-in, Apple sign-in, identity
  linking, and cross-device workbook synchronization. The 2.1.1 draft validated these public
  values in its release-input job but did not expose them to the separate native build jobs, so an
  installed 2.1.1 package reported that Cavalry Cloud was not configured.
- The native release matrix now fails before signing if either Cloud value is absent or if the
  generated host bundle does not contain both validated values. This checks the artifact input
  rather than only the workflow environment and prevents a signed but Cloud-disabled build from
  reaching the draft again.

### Compatibility and release notes

- No workbook schema or Cloud ownership migration is required. Existing local files and securely
  stored Cloud sessions remain compatible after replacing 2.1.1 with 2.1.2.
- The 2.1.1 draft must not be published or installed. Version 2.1.2 supersedes it with fresh signed
  and notarized packages for Apple Silicon and Intel Macs.

## 2.1.1 - 2026-08-27

### Changed

- Reissued Cavalry for Mac as a fix-forward release so the existing Cavalry Cloud Apple sign-in
  and identity-linking experience is delivered with complete updater packages for both Apple
  Silicon and Intel Macs. Apple authentication opens in the system browser and returns through the
  exact `cavalry://auth/callback` installed-app callback.
- Signed-in Cloud owners can connect Apple to the same immutable hosted Cloud owner used by Google and
  mobile, including when Apple Hide My Email is selected. Cavalry does not merge owners by email or
  create a second Cloud library for an explicitly linked identity.

### Fixed

- Restored the complete seven-file macOS release inventory. The public 2.1.0 release was missing the
  Intel updater archive and detached signature after an earlier duplicate-release collision; 2.1.1
  publishes fresh signed updater archives, signatures, disk images, and one updater manifest under
  a new immutable version.

### Compatibility and release notes

- No workbook schema migration is required. Cavalry remains local-first, and signing in alone does
  not upload or replace the open workbook; subsequent successful saves enter the existing Cloud
  synchronization queue.
- The production Cloud configuration redirected Apple authorization through the legacy hosted
  identity provider. Provider secrets were not embedded in the application or release metadata.
- The GitHub release remains a draft until signed and notarized packages pass the cross-application
  Apple identity checks in the Cloud OAuth runbook and an independent reviewer approves
  publication.

## 2.1.0 - 2026-08-21

### Added

- Added transparent, device-local Companion memory backed by a human-readable `memory.md`. Chat
  settings can view, add, edit, forget, clear, reload, and open the file or its folder. Revisioned
  atomic writes, external-edit refresh, conflict handling, and bounded relevance selection keep the
  user-editable file authoritative without uploading or synchronizing it as a standalone file.
- Added a supported Companion action for creating or updating an expected-income plan for a
  specific month and stable income category. It validates the amount, period, and category, uses
  Cavalry's normal persistence boundary without a separate confirmation prompt, and leaves existing
  manually entered expected-income plans unchanged.
- Added feature-owned, auto-discovered Companion capability contracts. Callable definitions,
  validation, entity requirements, access and confirmation policy, compatibility metadata,
  execution, and structured results now come from one inspectable registry instead of a separate
  prompt inventory.

### Changed

- Companion turns now keep request-scoped streaming text transient and persist only the final
  user-facing message and deliberately designed components. Tool preambles, reasoning, progress,
  raw payloads, and other protocol artifacts are excluded from the transcript; cancellation and
  failures reconcile to one readable terminal response.
- Financial completion messages now come from structured Cavalry action receipts. Requested,
  proposed, awaiting-confirmation, committed, cancelled, failed, rolled-back, and
  committed-but-unverified outcomes remain distinct, and a write is described as complete only
  with explicit durable save and verification evidence.
- Explicit account, wallet, source, destination, and credit-card names are resolved to stable
  Cavalry identifiers before execution. Role-aware matching preserves a confidently named target,
  rejects ambiguous matches for clarification, and includes the resolved account in the receipt.
- Transaction replacement is staged and validated as one operation, uses a proposal fingerprint
  and operation key, and is idempotent on retry. A failure keeps the original record; a replay with
  changed inputs or workbook state is rejected instead of creating a partial or duplicate result.
- Companion guidance is more conversational about decisions and tradeoffs while keeping advice,
  reads, proposed changes, and confirmed writes distinct.
- Chat messages have more breathing room, clearer separation for receipts and warnings, and
  horizontally scrolling wide tables with roomier cells at narrow and wide window sizes.
- The macOS release matrix now runs Apple Silicon and Intel sidecars on matching GitHub-hosted
  architectures. Draft asset verification checks the exact seven uploaded application archives,
  disk images, detached updater-signature files, and updater manifest before publication;
  cryptographic signing and notarization remain separate workflow and manual certification gates.

### Compatibility and release notes

- No workbook schema migration is required. Existing financial data, manually entered
  expected-income plans, and reimbursement behavior remain unchanged; reimbursement compatibility
  is covered by a frozen regression fixture.
- Local memory is opt-in and stored only in the application's local user-data directory. Relevant
  memory snippets can become part of a provider request when memory is enabled, following the same
  selected-context disclosure boundary as other Companion context.
- Validation: repository formatting, lint, type checks, production builds, unit/renderer/host,
  integration, end-to-end, architecture, license, Rust, release-metadata, and native certification
  gates must pass before publication. Exact results will be recorded in the v2.1.0 GitHub release
  draft before publication.
- Signing/notarization status: the GitHub `release-signing` environment supplies signing credentials,
  while Developer ID signing, Apple notarization and stapling, Gatekeeper and
  architecture checks, updater metadata verification, and manual target-architecture certification
  remain publication gates. Independent second-reviewer sign-off is also required, but the
  environment currently has no configured non-self reviewer and does not enforce that sign-off. The
  workflow creates a draft release; it must not be published until every gate passes and a second
  reviewer is obtained.
- Known limitation: memory relevance selection is intentionally local, bounded, and lexical rather
  than a hidden remote semantic index. Users can inspect and correct the exact source file at any
  time.

## 2.0.3 - 2026-08-20

### Changed

- Every dropdown is now drawn by Cavalry instead of the operating system. Account, category, type,
  currency, filter, and settings pickers share one menu with leading icons, group headings, a
  right-aligned detail column, and a check on the current choice. Account menus now show the
  account type and balance beside each name.
- Account cards give the account name and its balance the full width of the card rather than making
  them compete for one row, so neither is truncated. Accounts are grouped into labelled Assets and
  Liabilities bands in both grid and list view.
- The balance history chart is readable on the paper canvas: its gridlines and zero baseline were
  drawn in translucent white and were invisible, and a white plot panel sat inside a cream card.
  It now has one surface, a labelled value axis with rounded amounts, and colouring that follows
  account semantics, so a climbing credit-card balance reads as a loss rather than a gain.
- The Monthly Plan has an All tab that shows spending, income, savings, and debt on one screen.
- Every route now clears its page-title rule by the same amount, instead of the rule sitting on top
  of the first card on Accounts and the Monthly Plan.
- The Monthly Plan no longer shows a "Totals checked" banner when nothing needs attention. The
  unresolved-items warning still appears.

### Fixed

- Account pickers no longer print their placeholder underneath the leading icon. WebKit ignores
  padding on a system-drawn `<select>`, so the space reserved for the icon was dropped in the
  packaged application while looking correct in a development browser. This affected "Paid with",
  "From account", "To account", "Charged to", and "Refunded to".
- Icons no longer render as zoomed-in crops. Badge styling was applied to the glyph itself rather
  than to a container, so artwork filled its badge edge to edge in account rows, the account type
  picker, bills, and category list view.
- Pressing Escape to dismiss an open dropdown no longer closes the surrounding dialog and discards
  a half-completed transaction.
- Long transaction descriptions in the detail panel no longer slide underneath the close button.

### Notes

- Renderer-only release; no workbook format, host, or updater changes.

## 2.0.2 - 2026-08-20

### Fixed

- The desktop application no longer hangs on "Opening workbook" and then fails with "Workbook could
  not be opened". The bundled Cavalry host embeds Node, and Tauri signs every bundled executable
  with the hardened runtime, but the entitlements granted only microphone access. V8 was therefore
  killed with SIGTRAP inside `pthread_jit_write_protect_np` the instant it initialised, so the host
  never started, every workbook request waited for a host that was already dead, and the buttons on
  the failure screen had nothing to talk to. The `com.apple.security.cs.allow-jit` and
  `com.apple.security.cs.allow-unsigned-executable-memory` entitlements are now granted. This
  affected only signed builds, which is why it never appeared in development.
- The release workflow now runs the signed host sidecar and waits for its ready handshake before
  publishing. Neither code signing nor notarization can detect a sidecar that dies on launch, so
  this failure shipped in both 2.0.0 and 2.0.1 without any build reporting a problem.

## 2.0.1 - 2026-08-19

### Fixed

- Signed macOS releases are now notarized and stapled. The release workflow passed the App Store
  Connect key path in place of the key ID, so Tauri logged a warning and skipped notarization while
  the build still reported success; the disk image is now notarized as well as the application, and
  the build fails if either is unsigned, unnotarized, or unstapled.
- Desktop host failures now report their reason. Tauri rejects a command with a plain string, so
  every host error was replaced by a generic "The workbook file could not be loaded."
- The startup error screen's buttons now respond. "Try Again" retries loading the workbook instead
  of opening a file picker, and "Open Another Workbook" reports a reason when the picker cannot open
  rather than silently redisplaying the same screen.
- A workbook stored in an operating-system protected folder now explains that Cavalry needs folder
  access, instead of surfacing a raw "EPERM: operation not permitted".

## 2.0.0 - 2026-08-19

### Changed

- Replaced the Electron desktop shell with Tauri 2 while preserving the React renderer, finance packages, workbook format, and existing visual design.
- Added a Rust-owned native boundary and isolated Cavalry host sidecar for workbook, Cloud, Companion API, Advisor, and local-model services.
- Replaced Electron packaging and update configuration with Tauri capabilities, target overlays, signed updater metadata, and native release workflows.
- Updated repository structure, tests, security controls, and documentation for the Tauri runtime.
- Documented the required reauthentication, installed-client handoff, native certification, signing, and updater transition gates.

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
  owner-scoped hosted Cloud account data required by the iOS deletion flow.
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
  legacy Cavalry Cloud project.
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
- Kept hosted Cloud sessions, tokens, private object paths, and network calls in Electron main behind trusted, narrowly scoped IPC; owner-bound request keys make lost responses safely retryable, while account changes invalidate private results and clear unsent descriptions and images.
- Added owner-scoped report and attachment quotas, forced RLS, RPC-only report creation/finalization, and operation-aware policies for a private `feedback-attachments` bucket. No service-role secret or durable image bytes are exposed to the renderer.
- This retired feedback feature required a hosted Cloud schema deployment. Existing workbook files and Cloud snapshots required no migration.
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
- Added encrypted Cloud-session persistence in the macOS keychain, main-process-only OAuth credentials, strict callback and IPC validation, and owner-scoped row-level access controls.
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
- Added a notarized Apple-silicon and Intel macOS release channel with opt-in background updates, restart/install prompts, and a tag-to-draft GitHub publication gate.
