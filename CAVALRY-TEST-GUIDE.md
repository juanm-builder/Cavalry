# Cavalry v1.0.26 — Mac test guide

This handoff is a **source package**, not a signed or notarized Cavalry installer. It is based on Cavalry v1.0.25 at commit `162913b06fc98fbaa2154f41385c8228d296d800` and contains the trust-critical finance work plus the calmer Monthly Plan and Bills interface refinement requested after the first v1.0.26 test.

## 1. Prepare a safe test copy

1. Duplicate your real Cavalry workbook in Finder before opening it with this build.
2. Keep the original untouched until you have reconciled the duplicate against the current app.
3. Do not reuse or copy the `node_modules` folder from an earlier ZIP. Native dependencies must be installed fresh on your Mac.

## 2. Install and launch

Requirements:

- macOS
- Node.js 22
- npm 10 or newer; the repository records npm 10.9.2

In Terminal, open the extracted `Cavalry-v1.0.26` folder and run:

```bash
npm run verify:trust
npm ci
npm run check
npm run test:integration
npm run test:e2e
npm run dev
```

`npm run verify:trust` is dependency-free and checks ten trust-critical rules before installation. `npm run check` performs formatting, license, lint, type, build, and test gates after dependencies are installed.

If `npm ci` reports a native-package mismatch, remove only generated dependencies and retry:

```bash
rm -rf node_modules apps/mac/node_modules packages/*/node_modules
npm ci
```

Development mode disables normal update checks, so it will not replace this test build with the published release.

## 3. Acceptance test: the calmer Monthly Plan

Open **Budget** with your duplicate workbook and verify the first screen before opening any details.

Expected result:

- The page starts with four primary cards: **Income plan**, **Spending plan**, **Recurring**, and **Unallocated**.
- Savings and debt appear as extra overview cards only when the month actually contains those targets.
- The old full-width Budget Usage color wall is gone.
- The status area is shorter and does not dominate the page.
- Only one plan list is visible at a time under **Your plan**. Use the Spending, Income, Savings, and Debt tabs to switch sections.
- Explanatory copy is brief. Secondary calculation definitions remain available under **More details** or **How this is calculated** rather than appearing everywhere.

The screen should answer the main questions quickly: what you expect to receive, what you plan to spend, what is already recurring, what has actually happened, and what remains unallocated.

## 4. Acceptance test: dialogs and scrolling

These checks specifically target the layout bugs visible in the screenshots from the first v1.0.26 build.

1. Click each Monthly Plan overview card.
2. Click at least one category row.
3. Click **Add to Plan** while the Budget page is scrolled near the top, middle, and bottom.
4. Resize the app window and repeat the checks.

Expected result:

- Detail views open as wide, centered dialogs rather than thin vertical rails.
- The dialog is positioned against the application window, not against the animated or scrolled route underneath it.
- The detail dialog uses internal scrolling when its content is long.
- **Add to Plan** is visible immediately without scrolling the Budget page to find it.
- The plan editor remains centered, keeps its actions visible, and scrolls internally only when the window is genuinely too short.
- Closing a dialog returns you to the same page position.

## 5. Acceptance test: refunds

Use a small synthetic example first.

1. Record a ₱3,000 Clothing purchase.
2. Record a ₱1,000 **Refund** against the same Clothing category and account.
3. Open Monthly Plan and inspect Clothing.

Expected result:

- Clothing spending is ₱2,000, not ₱4,000.
- The refund appears as a negative contribution in the calculation receipt.
- A cash-account refund increases cash flow by ₱1,000.
- A credit-card refund reduces the card liability and does not invent cash flow.

For this tranche, enter refunds through the standard transaction editor. The Assistant and Action Review were intentionally left unchanged, so AI-created refund drafts still follow the legacy assembly path.

## 6. Acceptance test: Monthly Plan calculations

Create or inspect one month containing an expense limit, a recurring commitment, a savings target, a debt target, and expected income.

Verify that:

- Manual spending limits and recurring commitments are displayed separately.
- A recurring bill does not silently increase its category’s manual limit.
- A commitment with no manual budget is shown as uncovered rather than merged automatically.
- Savings, debt, and expected income remain separate from spending.
- Missing or archived categories remain visible as repair items but do not enter trusted headline totals.
- Clicking a headline card or category row opens the records that calculate it.
- The detail total exactly matches the number you clicked.
- A custom date range covering only part of a month does not pretend the entire monthly plan applies; it explains that the full-month plan was excluded.
- Foreign-currency activity without a usable rate is shown as unresolved rather than silently converted or guessed.

## 7. Acceptance test: Bills & Subscriptions

### Headline and occurrence behavior

1. Note the values in **Needs Attention**, **Overdue**, **Due Soon**, and **Completed**.
2. Search for one recurring item.
3. Filter by account, category, and status.

Expected result:

- The headline cards continue to describe the selected Bills or Subscriptions scope; search and table filters only change the visible rows.
- Weekly, biweekly, quarterly, and yearly items contribute to an honest monthly equivalent.
- A partial item with `remainingAmount: 0` contributes zero remaining, not its original full amount.
- Clicking a bill opens the expected occurrence, status, amount, match evidence, and linked transaction before offering **Edit recurring rule**.
- Inactive recurring items are visible and can be restored.
- A USD item remains labeled USD in its editor and preview.
- Missing-category, archived-category, and unresolved-FX recurring items are called out instead of being trusted silently.

### Find possible recurring charges

1. Make sure the duplicate workbook contains several similar charges across different months, such as the same merchant and amount on roughly the same date.
2. Click **Find recurring charges**.
3. Review any suggested bill or subscription.

Expected result:

- Cavalry uses its existing transaction-pattern analysis to surface likely recurring charges.
- A suggestion shows the merchant, amount, cadence, supporting occurrence count, and confidence where available.
- Suggestions are review-only: scanning does not create a recurring item automatically.
- Clicking **Review** opens a prefilled recurring-item editor.
- The proposed due date advances to the next expected occurrence rather than reusing an already-past transaction date.
- Saving remains an explicit user decision.

This workflow does not modify the Assistant, advisor runtime, Action Review, Companion API, prompts, or model behavior.

## 8. Acceptance test: multi-year use

1. Navigate to December in one year.
2. Create a plan for January of the next year.
3. Save, close, and reopen the duplicate workbook.

Expected result:

- January is stored under its own durable `YYYY-MM` identity.
- The new year does not require a new workbook.
- Existing older sheets continue to open; legacy month-index sheets acquire a durable month key during normalization and persist it on a later save.

## 9. Reconcile your real duplicate

For the first real pass, compare these values against your own records:

- total spending for the month;
- the three largest expense categories;
- all refunds, charge reversals, returns, and reimbursements;
- recurring commitments due this month;
- savings contributions;
- debt-principal payments;
- credit-card payments, interest, and fees;
- foreign-currency transactions.

When a number looks wrong, open its calculation receipt and record the transaction IDs shown there. Do not repair the only copy of your workbook during this first pass.

## 10. Build an ad-hoc Mac package

After all checks pass:

```bash
npm run package:mac
```

For an Intel Mac:

```bash
npm run package:mac:intel
```

These are local ad-hoc packages. They are not the signed and notarized production artifacts produced by Cavalry’s release workflow.

## Known limits of this v1.0.26 handoff

- The source package does not contain `node_modules`, generated builds, Git metadata, or a signed DMG.
- Historical refunds already stored as ordinary income cannot be reclassified safely without your review.
- Assistant/Action Review source is unchanged; use the standard transaction editor for refunds.
- Recurring-charge discovery is pattern-based and review-first. It can miss irregular bills or suggest a repeated purchase that is not truly recurring.
- This remains the trust-critical and finance-interface tranche, not the completion of every architecture and visual recommendation in the full audit.
