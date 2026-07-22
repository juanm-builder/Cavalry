# Cavalry documentation

The maintained documentation follows the workspace architecture. Start with the smallest section that owns the change you are making.

## Maintained guides

- [`architecture/`](architecture/README.md) — workspace map, package boundaries, and dependency direction.
- [`development/`](development/README.md) — root commands, contribution workflow, and changelog policy.
- [`features/`](features/README.md) — core finance feature documentation and QA maps.
- [`integrations/`](integrations/README.md) — Advisor, Companion API, sync, cloud, and llama.cpp material.
- [`operations/`](operations/README.md) — security, generated artifacts, packaging, and release checks.
- [`adr/`](adr/README.md) — durable architecture decisions.

Source-layer README files live beside their code in each package. Curated Companion examples live under `packages/companion-api/examples/`; sanitized portable workbook examples live under `examples/workbooks/`.
