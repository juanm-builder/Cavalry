# Native desktop certification

This checklist is the release gate for Cavalry's Tauri desktop runtime. Complete it on the exact source revision and target binaries intended for publication. Record the operating-system version, hardware, commit SHA, package version, test workbook, and result for every run.

## 1. Reproducible source and dependency setup

- [ ] Start from a clean clone with no untracked build output.
- [ ] Install the Node version declared in `.node-version` and run `npm ci`.
- [ ] Install the stable Rust toolchain and the required target triples.
- [ ] Generate and review `apps/desktop/src-tauri/Cargo.lock`; commit it before a production release.
- [ ] Run `npm run release:security`, `npm run verify:architecture`, and `npm run licenses:runtime:check`.
- [ ] Run formatting, linting, type checking, unit tests, integration tests, and renderer smoke tests.
- [ ] Run `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo check` from `apps/desktop/src-tauri`.

## 2. Native build matrix

Certify every published target independently:

- [ ] macOS Apple Silicon (`aarch64-apple-darwin`) built on `macos-15` with an `arm64` host.
- [ ] macOS Intel (`x86_64-apple-darwin`) built on `macos-15-intel` with an `x86_64` host.

For each target:

- [ ] Build the renderer and Node host bundle.
- [ ] Package the target-specific `cavalry-host` sidecar.
- [ ] Confirm the sidecar is present once, executable, has the target architecture, and is outside
      renderer access.
- [ ] Execute the signed packaged sidecar on the matching native host and capture its ready
      handshake. Do not accept a cross-architecture skip.
- [ ] Build the Tauri application using the signed release overlay.
- [ ] Confirm the application launches without a developer toolchain installed.
- [ ] Confirm no Electron, Chromium, Node source tree, development server URL, or source map is bundled unintentionally.

## 3. Interface and WebView parity

Compare the Tauri build against the accepted Cavalry reference on representative screen sizes.

- [ ] Dashboard, Transactions, Budget, Bills, Reports, Settings, Notes, and Companion layouts match the accepted design.
- [ ] Fonts, icons, spacing, shadows, dialogs, overlays, and dark/light appearance remain correct.
- [ ] Keyboard navigation, focus rings, tab order, copy/paste, undo/redo, and menu shortcuts work.
- [ ] Window restore, maximize, fullscreen, minimize, close, and macOS reopen behavior work.
- [ ] Scrolling, sticky regions, drag behavior, dropdown layering, and responsive drill-down panels work in WKWebView and WebView2.
- [ ] Accessibility names, roles, contrast, reduced motion, and screen-reader navigation are verified.

## 4. Workbook and finance behavior

Use a copy of a production-like workbook containing accounts, cards, transfers, refunds, recurring items, budgets, savings, debt, imports, and notes.

- [ ] Create, open, save, Save As, reopen, and recent-workbook flows work.
- [ ] Existing Cavalry workbook files open without schema or value changes.
- [ ] Autosave, rolling backups, crash recovery, and unsaved-change handling work.
- [ ] Running balances, transfers, refunds, category totals, budgets, recurring commitments, savings, and debt remain numerically identical to the accepted baseline.
- [ ] Spreadsheet import/export and round-trip behavior remain intact.
- [ ] File dialogs, downloads, and paths containing Unicode, spaces, and long names work.
- [ ] A forced host-sidecar failure does not corrupt the workbook and produces a recoverable error.

## 5. Cavalry Cloud and deep links

- [ ] Email/password sign-in, sign-out, session refresh, and profile retrieval work.
- [ ] OAuth opens in the system browser and `cavalry://` returns to both a running app and a cold-started app.
- [ ] A second app launch forwards its deep link to the existing process.
- [ ] Cloud workbook upload, download, conflict handling, and auto-sync work.
- [ ] Feedback submission and attachment handling work.
- [ ] Credentials are stored in macOS Keychain or Windows DPAPI-backed storage and are absent from logs and plaintext files.
- [ ] Missing or unavailable secure storage fails closed in a packaged build.

## 6. Companion and Advisor

- [ ] Companion API starts, stops, reports status, enforces authentication, and exposes the expected OpenAPI surface.
- [ ] Companion transaction, refund, budget, bill, subscription, workbook, and analysis tools operate against the correct workbook.
- [ ] Capability discovery reflects feature-owned manifests without a second prompt or handler
      catalog. Add, deprecate, make unavailable, and remove a synthetic capability and confirm the
      exposed definitions and execution behavior update together.
- [ ] Capability metadata exposes bounded input/output schemas, entity requirements, access,
      confirmation, validation, handler, result presentation, availability, deprecation, version,
      compatibility, atomicity, and idempotency fields.
- [ ] Explicit accounts and cards resolve to their stable IDs; aliases resolve only when unique, and
      ambiguous candidates ask for clarification instead of choosing one.
- [ ] A confirmation replay preserves the canonical proposal, operation key, IDs, and fingerprint.
- [ ] An income-budget request creates the intended income budget for the explicit period without
      modifying an existing manual expected-income budget unless that budget was targeted.
- [ ] Replacement, correction, and move succeed atomically, roll back completely on every injected
      failure, and do not duplicate work when the same operation is retried.
- [ ] Existing reimbursement records retain the established income treatment and warning; Companion
      correction does not silently convert them to merchant refunds.
- [ ] Completed, cancelled, failed, rolled-back, and committed-but-unverified action receipts display
      language that agrees with commit, verification, entity, account, amount, date, and persistence
      fields.
- [ ] Inject a workbook save failure and confirm the old in-memory workbook remains current and no
      completed receipt is shown.
- [ ] Advisor provider credentials save, load, update, and clear securely.
- [ ] Streaming is transient and request-scoped; a tool-call preamble, stale delta, protocol frame,
      or partial provider response never becomes saved transcript content.
- [ ] A successful turn saves one coherent assistant message. Cancellation, timeout, error, and retry
      clear transient output and leave a clean terminal notice without duplicated messages.
- [ ] Wide and narrow Companion layouts preserve readable padding, responsive tables, composer
      spacing, action receipts, confirmations, and memory controls.
- [ ] `memory.md` is visible in settings with separate controls to open the file, open its folder, and
      reload it. The displayed path matches the application-data file.
- [ ] Create, update, and delete individual memory records; confirm clear-all; toggle memory use and
      approved chat updates; and use explicit chat remember and forget actions.
- [ ] Edit `memory.md` externally and confirm safe automatic refresh and explicit reload. Attempt to
      save an older revision and confirm Cavalry reports a conflict without overwriting the external
      edit.
- [ ] Interrupt a memory write and confirm the previous file remains readable and no temporary file
      is treated as the current memory document.
- [ ] Introduce malformed front matter and confirm settings show a diagnostic, model requests omit
      memory, and ordinary mutations do not overwrite the malformed file.
- [ ] Confirm only bounded relevant memory records reach the selected provider, the injected section
      is labeled untrusted background context, and disabling memory sends none of it.
- [ ] Microphone permission prompts, recording, cancellation, transcription, and denied-permission behavior work.
- [ ] Image and multimodal inputs work where supported.
- [ ] GGUF inspection and model/projector selection work.
- [ ] `llama-server` launch, adoption, logs, cancellation, restart, and shutdown leave no orphan process.

## 7. Migration from the Electron release

Follow [the Electron-to-Tauri migration runbook](electron-to-tauri-migration.md).

- [ ] Back up the existing workbook and application-data directory.
- [ ] Install the Tauri build over or alongside the supported Electron release using the chosen transition strategy.
- [ ] Confirm existing workbooks, recents, backups, and recovery data remain discoverable.
- [ ] Confirm the user is clearly told when Cavalry Cloud or Advisor reauthentication is required.
- [ ] Confirm old Electron `safeStorage` ciphertext is never copied to plaintext.
- [ ] Confirm rollback instructions preserve user data.
- [ ] Test the last Electron version to first Tauri version transition on a clean machine and an established user profile.

## 8. Signing, updater, and installer

- [ ] macOS application and all nested executables are signed with the intended identity.
- [ ] macOS notarization succeeds and the ticket is stapled; `spctl` and `codesign --verify --deep --strict` pass.
- [ ] Tauri updater artifacts and `latest.json` are signed with the release updater key.
- [ ] The updater public key in the build matches the private key used to sign artifacts.
- [ ] The tag resolves to the recorded immutable commit and the draft release targets that exact
      source revision.
- [ ] The draft has exactly seven assets: two `.app.tar.gz` archives, their two `.sig` files, two
      DMGs, and `latest.json`; there are no missing, duplicate, incomplete, or unexpected files.
- [ ] Both updater platform entries use immutable same-repository GitHub API release asset IDs and
      resolve to the expected uploaded archive.
- [ ] HTTPS updater URLs, versions, platform keys, signatures, filenames, complete inventory, and
      immutable asset references pass `tools/release/verify-release-assets.mjs` in GitHub mode.
- [ ] Test update from the previous Tauri version to the candidate, including cancellation, interrupted download, relaunch, and retained data.
- [ ] Confirm an installed Electron client is not pointed directly at the incompatible Tauri feed.
- [ ] Test clean install, repair/reinstall, update, and uninstall without deleting user workbooks.

## 9. Performance and distribution evidence

Measure on the same hardware and workbook for both the accepted Electron baseline and the Tauri candidate.

- [ ] Record installer size and installed application size.
- [ ] Record cold-start and warm-start time to interactive.
- [ ] Record idle memory after launch and after opening a representative workbook.
- [ ] Record CPU use at idle and during import, report generation, Companion streaming, and local-model operation.
- [ ] Record save/open duration for small, medium, and large workbooks.
- [ ] Confirm the Tauri migration provides a meaningful improvement without new regressions.

## 10. Release sign-off

A release is ready only when:

- [ ] All blocking checks above pass for every published target.
- [ ] Any accepted exception has an owner, impact statement, mitigation, and follow-up issue.
- [ ] The exact commit, hashes, signing identities, updater manifest, test evidence, and rollback instructions are archived.
- [ ] A second reviewer verifies the release artifacts before the draft release is published.
- [ ] The second reviewer records that both native sidecars executed, the seven-asset inventory
      passed, updater URLs resolved by immutable asset ID, and no artifact changed after
      certification.

Do not publish the draft until every blocking item above passes for both targets. An artifact
replacement after sign-off invalidates the affected evidence and requires the inventory verification,
native checks, and second-reviewer sign-off to be repeated.
