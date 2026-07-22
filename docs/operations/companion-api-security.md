# Companion API Security

Security posture:

- Local API startup is disabled by default and binds to `127.0.0.1` unless explicitly configured.
- Binding to `0.0.0.0` or `::` requires `CAVALRY_COMPANION_ALLOW_PUBLIC_BIND=1`.
- Beta tunnel mode requires `CAVALRY_COMPANION_PUBLIC_BASE_URL` and beta API key auth.
- Public beta URLs reject localhost/private hosts, query strings, fragments, userinfo, and token-like secrets.
- Dev auth requires bearer-token configuration outside tests.
- Production OAuth interfaces are stubs only; production OAuth is not implemented.
- GPT-facing OpenAPI does not expose apply/delete/archive/direct mutation endpoints.
- Request bodies are size-limited and oversize payloads return `payload_too_large`.
- All external writes are review-only draft creation.
- Idempotency keys replay the same draft group for the same body and return `idempotency_conflict` for a different body.
- Review URLs contain only draft group IDs and are validated against the current workbook before opening.

Stable scopes:

- `cavalry.read.capabilities`
- `cavalry.read.workbooks`
- `cavalry.read.summary`
- `cavalry.read.accounts`
- `cavalry.read.categories`
- `cavalry.read.transactions.recent`
- `cavalry.draft.create`
- `cavalry.draft.read`
- `cavalry.draft.apply` reserved for future Cavalry-side flows

Audit events include request ID, origin, caller type, workbook ID, scopes, operation ID, action count, draft group ID, issue counts, duplicate warning count, idempotency result, timestamp, and outcome. They do not include access tokens, raw request bodies, or raw action plans.

Beta token storage:

- Generate a token with `npm run token --workspace @cavalry/companion-api`.
- Verify a token configuration with `npm run token:verify --workspace @cavalry/companion-api`.
- Rotate a token with `npm run token:rotate --workspace @cavalry/companion-api`.
- Prefer `CAVALRY_COMPANION_BETA_API_KEY_HASH=sha256:<hex>` on the server.
- Use the raw token only in the Custom GPT Action auth field or temporary certification env.
- Raw beta keys are dev/beta only and should not be logged or committed.

The beta token is like a temporary key to your Cavalry draft API. Treat it like a password. If it leaks, disable the API and rotate the token.
