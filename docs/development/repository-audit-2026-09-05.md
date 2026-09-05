# Repository audit — 5 September 2026

This initial audit was followed by the [iCloud account-control review](icloud-account-review-2026-09-05.md) and the mobile repository's bug and rendering reviews. Those reports record the subsequent changes and newer test totals.

This pass audited the local Cavalry desktop repository and the sibling Cavalry Mobile repository, with changes limited to calculation cost, formatting cost, storage recovery, confirmed dead code, and compatible dependency maintenance. Existing layouts, styles, assets, navigation destinations, financial classification rules, and workbook formats were preserved.

Both repositories already contained uncommitted work. Starting status and patch snapshots were captured before editing. The changes described here are the additional changes from this audit: 18 code, test, and configuration files in each repository, plus these reports. The mobile screen and cloud-coordinator deletions visible in the working tree predate this audit.

| Review coverage                              | Desktop | Mobile |
| -------------------------------------------- | ------: | -----: |
| Files inventoried at the start               |     882 |    233 |
| Existing JavaScript/TypeScript files parsed  |     632 |    201 |
| Baseline application/workspace tests passing |   1,924 |    448 |
| Final application/workspace tests passing    |   1,934 |    454 |

Whole-repository coverage included file inventory, syntax and import/export analysis, unused-code candidate analysis, formatting, lint, type checking, builds, and the available automated tests. The final syntax/import pass covered 834 JavaScript/TypeScript files, including the new formatter, with no syntax errors or unresolved relative code imports. Detailed manual review concentrated on finance calculations, local persistence, synchronization boundaries, assistant tools, renderer formatting, native integration, configuration, and release scripts. Public compatibility exports and dynamically loaded modules were retained where an import scan alone could not establish that they were dead. Dependency directories, Git internals, and ignored generated build products were excluded from source inventory.

**Calculation and presentation improvements.** Transaction reporting previously rebuilt an account index for each transaction and repeatedly searched categories. Reports, receipts, and transaction tables now build reference indexes once per synchronous calculation. The reader preserves first-match category and last-match account lookup behavior for duplicate IDs and is recreated on each pass so workbook edits cannot reuse stale indexes. Date-range endpoints are also normalized once per filter pass.

Account and category accumulators now use prototype-free internal dictionaries. Imported IDs such as `__proto__`, `constructor`, and `toString` retain their balances and category totals. Returned values remain ordinary objects, preserving the existing public interface. Regression cases cover these IDs, duplicate references, refunds, unresolved exchange rates, and recalculation after workbook edits.

Desktop transaction, account, budget, dashboard, and bill formatting now shares a bounded cache of 32 currency formatters. Locale, precision, rounding inputs, invalid-currency fallbacks, and displayed strings remain the same. ISO date-only values are displayed in UTC to retain their calendar date; timestamp values continue to use local time and caller options. Time-zone regressions cover Los Angeles and Manila.

The five edited shared finance implementation files were synchronized byte for byte to the mobile vendor copy. Three pre-existing differences in the settings view model, transaction submit intent, and transaction command service were deliberately preserved because they contain unrelated feature differences.

**Storage recovery.** Mobile SQLite opening and schema-setup failures no longer leave a permanently rejected cached promise. A failed setup closes its connection and preserves the original error even if cleanup fails. Subsequent calls can reopen the database. Startup retries a failed active-workbook read once; a persistent read failure leaves the existing read-only preview state instead of treating the device as empty and creating a replacement workbook. Regression tests cover open, setup, cleanup, and startup failures, recovery, connection reuse, and absence of replacement writes.

**Dead code and prevention.** Removed unused desktop route helpers, institution defaults immediately overwritten by explicit values, unused mobile route and contract wrappers, and construction of unadvertised assistant write-tool schemas. The assistant still advertises the same read/navigation tools and rejects the same 27 known write commands. Desktop lint now checks unreachable code, constant conditions outside loops, duplicate keys, and unsafe optional chaining. Mobile TypeScript now checks unused locals and parameters.

**Dependency maintenance.** Desktop dependency and release-security checks reported no advisories. Mobile had 16 moderate affected dependency nodes before this pass. A scoped `xcode` override upgrades only its `uuid` dependency from 7.0.3 to 11.1.1; the lockfile comparison confirmed that only this resolved package changed. Xcode project parsing and generation of 100 valid, unique project IDs passed with the replacement. This resolves the affected `uuid` dependency chain described in the [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

Mobile still has three moderate affected nodes from one root issue: `expo-router` → `query-string` → `decode-uri-component`. The [decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) is fixed in 0.5.0, but that release is ESM-only while the installed query-string integration expects CommonJS. Forcing the upgrade, or accepting npm's proposed Expo Router downgrade, would introduce compatibility risk. Native incoming routes now validate percent encoding before reaching that decoder; malformed input returns to the root route, while valid routes and workbook file imports retain their existing handling. This is a boundary mitigation, not a claim that the dependency advisory is eliminated. The remaining upgrade needs a compatible upstream router/query-string release.

**Measured performance.** A one-off differential benchmark compared the saved starting implementations with the final implementations. It verified 1,156 deep-equality comparisons over six workbook fixtures, 30 deterministic synthetic workbooks before and after mutation, null/empty workbooks, multiple date ranges, flow types, and receipt metrics. Intended corrections for prototype-named IDs are covered separately by regression tests.

| Synthetic operation           |    Before |   After | Relative speed |
| ----------------------------- | --------: | ------: | -------------: |
| Period summary                |  53.81 ms | 8.87 ms |          6.07× |
| Calculation receipt           |  47.12 ms | 6.97 ms |          6.76× |
| Format 5,000 currency amounts | 108.90 ms | 1.74 ms |         62.75× |

These final measurements used the supported Node 22.23.2 runtime, 10,000 transactions, 100 accounts, 40 categories, and three display currencies. Each result is the median of nine alternating runs after warm-up. They describe isolated JavaScript operations, not whole-app latency or native rendering performance.

**Verification completed.**

- Desktop `npm run check` under Node 22.23.2: formatting, lint, type checks, production builds, all 1,934 tests, architecture, runtime-license inventory, OpenAPI, and GPT instruction checks passed.
- Desktop integration suites: 228 tests passed; these overlap some main-suite coverage and are not counted as additional unique tests.
- Desktop `npm run test:e2e`: built-renderer and host/sidecar asset smoke checks passed. This script does not perform an interactive visual walkthrough.
- Desktop Rust formatting, locked compilation, and all three library tests passed.
- Desktop release-security checks passed, including the repository's workspace/history, Tauri capability/update configuration, and npm dependency checks.
- Mobile `npm run verify` under the pinned Node 24.18.0: type checks, lint, 50 Jest suites / 454 tests, 41 build-script tests, and native archive-input checks passed.
- Mobile whole-repository formatting, EAS autolinking, Expo configuration introspection, and iOS production Hermes export passed.
- Mobile `scripts/xcode-workflow.mjs build` under Node 24.18.0: unsigned clean Debug iOS Simulator build passed. The generated app contains both arm64 and x86_64 architectures.
- Both repositories passed `git diff --check`; the five shared edited files match across repositories.

**Limits and follow-up.** No application layout, stylesheet, theme, or image asset was edited in this audit. Existing interaction tests passed, but this is not a screenshot comparison, a physical-device certification, or an authenticated end-to-end iCloud test. The desktop build continues to report its existing large-chunk warning; native dependencies emit compiler warnings. These were not suppressed or addressed through unrelated framework upgrades. No release was signed, deployed, committed, or pushed.

Raw logs, baseline snapshots, source-analysis results, session-only diffs, and the one-off benchmark remain in `/tmp/cavalry-audit-20260905` on the audit machine. That directory is temporary; this report records the durable conclusions.
