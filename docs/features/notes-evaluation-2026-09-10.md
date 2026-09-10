# Notes review evaluation — September 10, 2026

## Product behavior

Notes preserves freeform writing on the device. The offline **Review transactions** action extracts possible entries; **Use AI** is optional. Both lead to an editable preview and a separate **Add** action. Writing, pending candidates, and unfinished edits survive navigation and relaunch. Notes drafts are device-local rather than workbook sync content.

The source note remains intact after extraction and saving. Clear has an undo action. A failed draft write is visible. The application must not overwrite an unreadable draft during initial loading.

## Reproduced baseline failure

In the packaged Mac app, these four lines became four incomplete transaction rows, and the original writing disappeared:

```text
Thursday notes
Remember to buy coffee tomorrow
Need to check the grocery receipt
Not sure which card I used
```

No ledger transaction was created in that baseline test. The synthetic draft rows were cleared afterward.

## Automated regression coverage

- Headings, reminders, totals, and prose remain ordinary writing.
- Date headers, bullet lists, continued fields, and semicolon-separated purchases retain source evidence.
- Ambiguous amounts, corrections, dates, and payment accounts require review.
- Transfers, refunds, debt payments, and recurring setup cannot become ordinary expenses merely by confirming fields.
- AI confidence does not override contradictory source amounts, dates, currencies, or accounts.
- Offline review makes no provider calls. AI failure falls back to review without ledger writes.
- Extraction does not commit. Confirming an uncertain draft does not commit. Only Add writes new entries.
- Changing the source blocks an outdated preview; a late AI result cannot overwrite a changed workbook.
- Repeated purchases within one note remain separate. Preparing already-added source records does not add them again.
- Unfinished edits restore after remount. Clear is reversible. Storage and application commit failures retain the draft.
- Editing an added row updates its existing ledger transaction; Cancel leaves the transaction unchanged.
- A Notes save through the app shell reaches workbook persistence and browser recovery storage.

Native candidate results and release artifact verification are recorded with the release evidence, against the exact candidate revision.

## Packaged Mac acceptance — September 11

Tested the signed local 2.2.13 candidate in the native WKWebView on the user's synthetic Main Plan, then repeated the affected presentation cases in the rebuilt candidate.

- Offline mixed note: an ISO date heading, coffee purchase, ambiguous lunch amount, taxi-receipt reminder, total, and transfer produce exactly three candidates. The reminder and total remain in the original note. Only coffee is ready; ambiguous lunch and transfer cannot post.
- Pressing Confirm details on the transfer remains blocked with guidance to use Add Transaction.
- Added one synthetic coffee entry at PHP180, edited it to PHP175, and verified one ledger transaction with the correct date, Food category, GCash account, and PHP175 account effect. Deleted it afterward.
- Live configured AI: “one kay Grab home from NAIA, paid with GCash” became PHP1,000/Transport and “cofee — 180 PHP — GCash” became PHP180/Food, both dated 2026-09-10 from the heading. Neither was posted automatically; source text stayed intact.
- An unfinished PHP185 correction to the second AI draft survived quit, app replacement, relaunch, and navigation back to Notes.
- Removing the saved ledger transaction while its Notes editor had been left open did not strand the review UI.
- The final preview shows the actual GCash account and “Check amount” for an unresolved amount.
- Native visual sanity covered Notes in Cerulean and Dark, Dashboard, Transactions, Accounts, Bills, general Settings, the Subscriptions budget detail icon, and the add action in an empty Debt plan section. Cerulean was restored.

Cleanup: Notes draft/list cleared; synthetic ledger entry removed. Net worth returned to PHP1,067,326.29 and GCash to PHP56,017.31. Provider credentials were used by the configured app and were never viewed or copied.
