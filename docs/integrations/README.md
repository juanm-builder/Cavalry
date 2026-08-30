# Integrations

Advisor, Companion API, Custom GPT, checkpointed apply, cloud/sync, and local-model support are optional or experimental unless a feature document says otherwise.

- [`beta-integrations.md`](beta-integrations.md) — integration index and support status.
- [`companion-api-overview.md`](companion-api-overview.md) — Companion API entry point.
- [`companion-api-local-dev.md`](companion-api-local-dev.md) — local server operation.
- [`companion-api-gpt-actions.md`](companion-api-gpt-actions.md) — Custom GPT action contract.
- [`cavalry-companion-gpt.md`](cavalry-companion-gpt.md) — Companion GPT workflow.
- [`tools/llama-cpp-launcher/README.md`](../../tools/llama-cpp-launcher/README.md) — optional local llama.cpp launcher.

Integrations must remain disabled or safely degraded by default and cannot become a dependency of workbook access or core finance workflows.

Current sync scope is the local conflict/readiness foundation in `packages/sync-foundation/`.
Private CloudKit snapshot synchronization is documented in
[the maintained feature guide](../features/icloud-sync.md).
