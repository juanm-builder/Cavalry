# @cavalry/companion-api

Optional local HTTP API, authentication, OpenAPI contract, and draft-first external workflows.

This package depends on the public finance, review, and Advisor contracts. It must not become a required dependency for the normal desktop finance workflow.

Package-owned source, OpenAPI, examples, scripts, and tests live together here. Generated certification and beta artifacts are written to the repository-level `test-artifacts/` directory regardless of the caller's current directory.

## Commands

Run from the repository root:

```sh
npm test --workspace @cavalry/companion-api
npm run check --workspace @cavalry/companion-api
npm run serve:local --workspace @cavalry/companion-api
```

Provider/tunnel integrations remain disabled unless their documented environment flags are explicitly enabled. See the [Companion overview](../../docs/integrations/companion-api-overview.md), [local development guide](../../docs/integrations/companion-api-local-dev.md), and [security guide](../../docs/operations/companion-api-security.md).
