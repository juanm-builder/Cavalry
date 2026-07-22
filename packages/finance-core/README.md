# @cavalry/finance-core

Platform-independent financial domain and application logic for Cavalry.

This package owns workbook schema normalization and portable serialization, money and ledger rules, accounts, categories, transactions, budgets, recurring items, reporting, dashboard projections, and CSV import/export. It does not own Electron, filesystem, process, network, DOM, React, Advisor orchestration, or action-review behavior.

## Public API

Use the package root for the complete public surface, or one of the explicit `application/*` and `domain/*` export-map paths for a focused import:

```js
import { roundMoney } from '@cavalry/finance-core/domain/money.js';
import { buildManualLedgerTransaction } from '@cavalry/finance-core/domain/ledger/transactions.js';
import { serializeWorkbookForSave } from '@cavalry/finance-core/application/workbook/workbook-persistence-service.js';
```

All modules are ESM and safe to import in a browser build. Native file writes and rolling backups are implemented by the Mac main-process adapter; finance-core only parses, normalizes, validates, and serializes workbook data.

## Dependency rule

finance-core may depend only on other finance-core modules. Higher-level workspaces such as Advisor, action review, Companion API, sync, and the Mac app depend on this package, never the reverse.

## Tests

Run the package-owned domain and application suite from the workspace root:

```sh
npm test --workspace @cavalry/finance-core
```

Reusable workbook and ledger scenarios are exposed under `@cavalry/finance-core/test-fixtures/*` for higher-level package and Mac integration tests.
