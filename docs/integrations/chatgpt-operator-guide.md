# ChatGPT integration operator guide

The Companion API is a separately enabled, draft-first integration. It binds to localhost by default and must not become a dependency of opening, editing, or saving a workbook.

## Local server

Start the package-owned server with explicit local configuration:

```bash
CAVALRY_COMPANION_API_ENABLED=1 \
CAVALRY_COMPANION_API_MODE=local_dev \
CAVALRY_COMPANION_DEV_TOKEN=dev-token \
npm run serve:local --workspace @cavalry/companion-api
```

Bearer authentication is required when configured. Public binds require an explicit dangerous-bind opt-in. See the [Companion security guide](../operations/companion-api-security.md).

## Contracts and certification

The maintained GPT Actions schema is `packages/companion-api/openapi/cavalry-gpt-actions.openapi.yaml`.

```bash
npm run openapi:validate --workspace @cavalry/companion-api
npm run openapi:action-sanity --workspace @cavalry/companion-api
npm run gpt-action:certify --workspace @cavalry/companion-api
npm run test:integration
```

The schema intentionally exposes reads and draft creation, not direct apply/delete/transaction-mutation endpoints. External draft creation appends redacted events to `workbook.externalApiAuditEvents`; audit exports omit request fingerprints unless explicitly requested.

Use the public `@cavalry/companion-api` package entry points in code. Operational scripts and integration-specific commands remain in that workspace rather than expanding the root command facade.
