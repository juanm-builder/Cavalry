# Companion API Overview

The Companion API is a draft-first boundary between ChatGPT and Cavalry. Cavalry remains the source of truth for workbook data, validation, review, and final commits.

GPT-facing write-like operations only create external draft groups:

- `createCavalryDraftGroupFromActionPlan`
- `createCavalryTransactionDraftBatch`
- `createCavalryRecurringItemDrafts`
- `createCavalryCategoryChangeDrafts`

The API does not expose apply, delete, archive, account creation, category creation, or direct transaction posting. Every external draft must be reviewed inside Cavalry before it can change ledger data.

Stable v1 contract:

- Action plan version: `1.0`
- OpenAPI file: `packages/companion-api/openapi/cavalry-gpt-actions.openapi.yaml`
- Review URL scheme: `cavalry://draft-groups/{draft_group_id}`
- Certification command: `npm run gpt-action:certify --workspace @cavalry/companion-api`
- Power-user beta doctor: `npm run beta:doctor --workspace @cavalry/companion-api`
- Custom GPT beta bundle: `npm run beta:bundle --workspace @cavalry/companion-api`
- Recent audit export: `npm run audit:recent --workspace @cavalry/companion-api`

Runtime modes:

- `disabled`: default.
- `local_dev`: explicit local testing.
- `beta_tunnel`: manual Custom GPT beta testing through a developer-provided public URL and beta API key.
- `cloud_stub`: future boundary only.

Local/dev readiness is implemented. Power-user beta tunnel dogfood is packaged for manual testing when a tester configures a real HTTPS tunnel and beta token. Production cloud readiness is intentionally documented as incomplete until real OAuth, hosted HTTPS, durable stores, deployment operations, and support procedures exist.
