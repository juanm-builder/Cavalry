# Cavalry API Security

Cavalry owns workbook truth, validation, review, and commits. ChatGPT owns conversation and suggestions.

Security guarantees:

- External write-like requests create draft groups only.
- The GPT-facing OpenAPI spec does not expose apply, delete, archive, or direct transaction-posting endpoints.
- Every external draft group records origin metadata.
- Every draft-creation request writes an audit event without logging full sensitive notes.
- Idempotency keys prevent duplicate draft groups on retries.
- Workbook core fingerprints remain unchanged during draft creation.
- Applying requires an explicit Cavalry-side confirmation path.

OAuth-ready scopes:

- `cavalry.read.capabilities`
- `cavalry.read.workbooks`
- `cavalry.read.summary`
- `cavalry.read.accounts`
- `cavalry.read.categories`
- `cavalry.read.transactions.recent`
- `cavalry.draft.create`
- `cavalry.draft.read`
- `cavalry.draft.apply` reserved for future Cavalry-side apply flows

Local dev auth is disabled by default. Set `CAVALRY_API_ENABLED=1`, `CAVALRY_API_DEV_AUTH=1`, and `CAVALRY_API_DEV_TOKEN` only for local testing. Production must use HTTPS, OAuth, short-lived access tokens, callback allowlists, request size limits, rate limits, durable audit/idempotency stores, and per-user workbook authorization. Cloud production hosting is not implemented.

Data minimization:

- Read endpoints return curated fields.
- The API does not return bank credentials, tokens, or raw workbook internals.
- Private notes should stay out of exports unless the user explicitly chooses full-detail sharing.

Threat model:

- Prompt instructions are helpful but not trusted.
- Account/category IDs are trusted only when returned by Cavalry and authorized for the workbook.
- Cross-workbook IDs are rejected.
- Direct mutation claims are treated as unsafe and blocked.
