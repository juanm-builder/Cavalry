# Companion API GPT Actions

Import `packages/companion-api/openapi/cavalry-gpt-actions.openapi.yaml` for local/dev review, or generate a tunnel-specific beta file with `npm run beta:openapi --workspace @cavalry/companion-api`. The schema is draft-first and marks read operations as non-consequential while draft-creation operations are consequential.

Required GPT behavior:

- Read capabilities and workbook metadata before drafting when IDs are needed.
- Use the returned workbook, account, category, and transaction IDs instead of inventing IDs.
- For account advice, call account or summary read actions and use the returned balances.
- Create draft groups only.
- Never claim a transaction was posted.
- Tell the user to review the returned `cavalry://draft-groups/...` URL in Cavalry.
- Treat duplicate warnings, missing accounts, missing categories, image-derived uncertainty, and low confidence as review signals.

Stable public error codes:

`invalid_action_plan`, `unsupported_action_type`, `missing_required_field`, `invalid_amount`, `invalid_date`, `invalid_currency`, `workbook_not_found`, `scope_denied`, `idempotency_conflict`, `duplicate_candidate`, `draft_validation_failed`, `payload_too_large`, `rate_limited`, `auth_required`, `auth_forbidden`, `server_not_enabled`.

Local/dev status: ready after `npm run gpt-action:certify --workspace @cavalry/companion-api` passes.

Beta tunnel status: run `npm run beta:certify --workspace @cavalry/companion-api`; if the public URL or auth env is missing, the command writes an honest skip report.

Production status: not ready until hosted HTTPS, OAuth, durable idempotency/audit/rate-limit stores, workbook access brokering, and operational monitoring are implemented.
