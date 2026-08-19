# ADR 0001: Workspace layout and dependency direction

- Status: Accepted
- Date: 2026-08-19

## Context

Cavalry combines portable finance rules, workflow packages, a React interface, native desktop integration, optional cloud services, and local model processes. Uncontrolled cross-imports would make runtime changes risky and finance behavior difficult to verify.

## Decision

Use one npm workspace with:

- `apps/desktop` as the composition root;
- reusable packages under `packages`;
- repository tooling under `tools`;
- cross-workspace guardrails under `tests/architecture`.

Dependencies point from the desktop app toward workflow packages and then toward `@cavalry/finance-core`. Lower-level packages do not import application code. Native, filesystem, process, network, DOM, and React behavior stays in its owning adapter.

## Consequences

The renderer can be reused across desktop shells, finance rules remain testable without native APIs, and runtime migration work is concentrated at explicit boundaries. Some adapter code is intentionally duplicated at the edge rather than leaking platform concerns into the domain.
