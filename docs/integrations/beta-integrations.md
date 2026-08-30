# Beta and experimental integrations

These capabilities sit above the local Mac finance workflow. They must remain disabled or safely degraded when unconfigured; opening, editing, and saving a workbook cannot depend on them.

## Advisor

- [Current acceptance and safety contract](../features/advisor-acceptance.md)

Provider-neutral semantics are maintained in `packages/advisor/`. Desktop-host transport, provider secrets, microphone access, and local-model process management stay in `apps/desktop/`.

## Companion API and Custom GPT

- [Companion API overview](companion-api-overview.md)
- [Implementation status](companion-api-implementation-status.md)
- [Local development](companion-api-local-dev.md)
- [GPT Actions contract](companion-api-gpt-actions.md)
- [Power-user beta](companion-api-power-user-beta.md)
- [Custom GPT beta test](companion-api-custom-gpt-beta-test.md)
- [Security boundary](../operations/companion-api-security.md)
- [Operator guide](chatgpt-operator-guide.md)

Examples and the maintained OpenAPI contract live in `packages/companion-api/`. Local and tunnel modes require explicit enablement. Hosted HTTPS, production OAuth, durable stores, and support operations are not implemented.

## Checkpointed apply

- [Checkpointed overview](companion-api-checkpointed-overview.md)
- [Checkpointed beta test](companion-api-checkpointed-beta-test.md)
- [Checkpointed security](../operations/companion-api-checkpointed-security.md)
- [Checkpointed release checklist](../operations/companion-api-checkpointed-release-checklist.md)

Checkpointed apply remains experimental, scoped, and opt-in. The normal GPT-facing contract is draft-only.

## Sync and local models

`packages/sync-foundation/` contains local types, change logs, conflict checks, and readiness reporting. Apple-device snapshot transport is implemented by native CKSyncEngine adapters behind the iPhone and Mac ports; conflicts remain explicit instead of being merged silently. The current boundary is documented in [`../features/icloud-sync.md`](../features/icloud-sync.md).

The optional llama.cpp launcher is documented in [`tools/llama-cpp-launcher/`](../../tools/llama-cpp-launcher/README.md). It is not a runtime dependency of `finance-core` or workbook access.
