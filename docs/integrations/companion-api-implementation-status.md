# Companion API Implementation Status

Status as of checkpointed beta hardening:

- Local/dev foundation: implemented.
- Beta tunnel package: implemented for developer/manual testing with explicit enablement, public base URL, and beta API key.
- Draft-first Companion API: implemented and still default.
- Power-user checkpointed apply: implemented behind explicit runtime flags and checkpoint scopes.
- Production cloud: not implemented.

Implemented GPT-exposed endpoints:

- `GET /v1/capabilities`
- `GET /v1/workbooks`
- `GET /v1/workbooks/{workbook_id}/summary`
- `GET /v1/workbooks/{workbook_id}/accounts`
- `GET /v1/workbooks/{workbook_id}/categories`
- `GET /v1/workbooks/{workbook_id}/transactions/recent`
- `POST /v1/workbooks/{workbook_id}/draft-groups/from-action-plan`
- `POST /v1/workbooks/{workbook_id}/drafts/transaction-batch`
- `POST /v1/workbooks/{workbook_id}/drafts/recurring-items`
- `POST /v1/workbooks/{workbook_id}/drafts/category-changes`
- `GET /v1/workbooks/{workbook_id}/draft-groups/{draft_group_id}`

Implemented checkpointed endpoints:

- `POST /v1/workbooks/{workbook_id}/checkpointed-action-plans/execute`
- `GET /v1/workbooks/{workbook_id}/checkpoints`
- `GET /v1/workbooks/{workbook_id}/checkpoints/{checkpoint_id}`
- `POST /v1/workbooks/{workbook_id}/checkpoints/{checkpoint_id}/rollback-preview`

Rollback execution exists for local/human-admin certification with `cavalry.ai.checkpoint.rollback`, but it is intentionally omitted from GPT-facing OpenAPI and beta GPT tokens by default.

Intentionally unsupported GPT-facing endpoints:

- Apply draft group
- Direct transaction create/post/update/delete
- Archive/delete/hide
- Direct account/category mutation
- Workbook mutation
- Checkpoint rollback execution from GPT
- Checkpoint disabling, checkpoint clearing, or auth/API settings changes

Runtime modes:

- `disabled`: default; no listener should start.
- `local_dev`: localhost testing with auth outside tests.
- `beta_tunnel`: manual Custom GPT testing through an explicit public/tunnel URL with beta API key auth.
- `cloud_stub`: future boundary only; does not start as production cloud.
- AI action mode defaults to `draft_only`. `checkpointed_apply` requires `CAVALRY_COMPANION_AI_ACTION_MODE=checkpointed_apply` and `CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1`.

Stores today:

- Idempotency store: in-memory workbook/session collection.
- Audit store: in-memory/workbook-local collection.
- Rate-limit store: controller in-memory map.
- Workbook access: local app/test workbook provider.

Production blockers:

- Hosted HTTPS API.
- Real OAuth/user authorization.
- Durable audit, idempotency, and rate-limit stores.
- Operational logging, monitoring, and token rotation.
- Security review for non-developer public beta.

Manual import parity:

- Manual import uses the same `CavalryActionPlan` parser, validator, and external draft service as the API path.

Review UI:

- API-created drafts project into the existing AI Drafts review queue.
- Review metadata includes origin, group ID, created time, counts, duplicate warnings, and “Nothing has changed yet.”
- Checkpointed actions appear in the AI Drafts area as a checkpoint review panel with applied/blocked/warning counts and a rollback-preview modal.

Operations surface:

- Companion enablement and credentials intentionally remain environment/CLI configuration rather than a general desktop setting.
- Current beta status surfaces are `GET /v1/capabilities`, `npm run serve --workspace @cavalry/companion-api`, `npm run checkpointed:certify --workspace @cavalry/companion-api`, and generated certification reports under the repository-level `test-artifacts/` directory.
