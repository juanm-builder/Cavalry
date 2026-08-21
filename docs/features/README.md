# Features

The finance workflow is local-first: open or create a workbook, record balanced ledger activity, plan and review money, and save the portable workbook through native and browser-cache adapters.

| Feature slice                                         | Reusable owner                                   | App owner                                           |
| ----------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Workbook schema, normalization, HTML/JSON portability | `finance-core`                                   | Mac storage/cache adapters and session reducer      |
| Dashboard, reports, and budgets                       | `finance-core` queries and commands              | React route controllers/views                       |
| Accounts and categories                               | `finance-core` management and safety rules       | React routes and modals                             |
| Transactions and import/export                        | `finance-core` ledger and import/export services | React composer, table, preview, and file effects    |
| Bills and recurring items                             | `finance-core` recurring services                | React bills route and editors                       |
| Drafts and checkpoints                                | `action-review`                                  | React review route and approval effects             |
| Advisor                                               | `advisor` plus `action-review` safety gates      | React conversation UI and injected transport        |
| Cavalry Cloud                                         | Supabase owner-scoped snapshots and RLS          | desktop-host auth/transport and Account settings UI |

See [Action Review](action-review.md) for the portable plan format,
[Advisor acceptance](advisor-acceptance.md) for its safety contract,
[AI Companion capabilities](ai-companion-capabilities.md) for the feature-tool registration contract,
[Companion trust architecture](companion-trust-architecture.md) for the streaming, action receipt, and
local-memory boundaries, and [Cavalry Cloud](cavalry-cloud.md) for the explicit-upload cloud boundary.

Treat the [architecture map](../architecture/README.md) as authoritative when choosing a home for new code.

## Current scope

The supported desktop workflow is workbook create/open, native and cache hydration, dashboard and budgets, accounts and categories, transactions and CSV import/export, settings and persistence, bills and recurring items, draft/checkpoint review, and Advisor. The application frame, route registry, workbook session, and feature callbacks are shared infrastructure rather than feature-owned state.

The current release does not redesign the interface, migrate beyond workbook schema version 2, automatically merge cloud changes, or host the Companion API. Cavalry Cloud provides explicit revision-checked snapshots and safely degrades when it is not configured. Optional integrations must remain disabled or safely degraded without affecting workbook access, editing, or saving. Production desktop packages are signed through the isolated release workflow; local development packages remain ad-hoc.
