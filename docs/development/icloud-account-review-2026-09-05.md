# iCloud account controls — 5 September 2026

This follow-up adds explicit account connection controls without changing workbook formats or deleting local/cloud workbooks. It follows the [repository audit](repository-audit-2026-09-05.md).

The account panel now distinguishes its editable local profile from the Apple Account used by CloudKit. It displays a short account reference derived from CloudKit's private user identifier, using the same convention as iOS, while Apple Account name and email remain available only in System Settings. CloudKit does not expose those identity fields by default; see Apple's [container documentation](https://developer.apple.com/documentation/cloudkit/ckcontainer).

Connect and confirmed disconnect actions run through the existing trusted renderer/host/native bridge. The disconnect preference is saved separately from account-specific cache state and survives app restarts. Disconnect preserves workbook copies, cancels the sync engine's work, and rejects new cloud commands. Retired engine callbacks cannot request new save records after reconnecting. Reconnect verifies the owner and retains the existing cache isolation on account changes. Refresh generations prevent an older status request from restoring a disconnected UI session.

This disconnect affects Cavalry on this device; Apple Account sign-out remains in System Settings. Requests already accepted by CloudKit may complete, consistent with Apple's [cancellation behavior](https://developer.apple.com/documentation/cloudkit/cksyncengine-5sie5/canceloperations%28%29).

The full `npm run check` passed under Node 22.23.2 with 1,938 tests, formatting, lint, types, builds, architecture, license inventory, and API checks. New tests cover the trusted connection IPC, input validation, persisted disconnected state, stale status results, account references, and confirmed connect/disconnect UI actions. Native Rust/Swift compilation passed. Authenticated two-device iCloud synchronization and physical-device sign-out remain unverified.

The sibling mobile repository contains the detailed rendering and simulator results in `cavalry-ios/docs/icloud-and-rendering-review-2026-09-05.md`. Existing user edits were preserved. Changes are local and uncommitted; no release or push was performed.

## Approved account layout follow-up

The account card now follows the supplied Mac reference: circular account glyph, Apple Account label, identity summary, adjacent Check Now / Disconnect controls, and a divided reference row with a copy button. The extra last-checked and cross-device helper lines are removed. Existing workbook and library controls remain below the card. Layouts wrap at narrow window widths and use the existing theme colors and typography.

CloudKit supplies a private account identifier, not a verified Apple Account name/email. The card therefore uses “iCloud account” and “Private iCloud library” with the real reference. It does not treat the editable local profile or the fictional design account as an authenticated identity.

Copy uses the native WebView clipboard API, reports failure, and leaves the reference selectable as a fallback. Account changes reset confirmation/copy feedback. The actual signed-in Mac app was inspected, and its copy action succeeded. The focused 29-test settings suite, desktop ESLint, type checking, and renderer/host production builds passed.
