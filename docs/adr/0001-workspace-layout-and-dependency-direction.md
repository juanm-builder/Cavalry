# ADR 0001: Workspace layout and dependency direction

- Status: Accepted
- Date: 2026-07-10

## Context

The Electron app, reusable finance rules, optional integrations, documentation, examples, and local-model tooling previously shared one app directory. That made platform boundaries implicit and left scripts and documentation dependent on the caller's working directory.

## Decision

Cavalry uses a root npm workspace. The Mac product lives in `apps/mac/`; reusable capabilities live in named packages; optional developer tools live in `tools/`; sanitized workbook examples live in `examples/workbooks/`; and repository-wide architecture tests live in `tests/architecture/`.

Dependencies point from the Mac app to workflow/integration packages and then to `finance-core`. `finance-core` cannot import Electron, Node platform APIs, the filesystem, processes, the network, the DOM, or React. Platform behavior is provided through explicit ports and adapters.

Root scripts are the maintained developer and CI interface. Package-specific commands may exist, but workflows and general documentation invoke them through the root workspace.

## Consequences

- Package export maps and architecture tests can enforce ownership.
- Native and UI effects remain visible at composition boundaries.
- Workspace-relative paths replace `process.cwd()` assumptions in shared tooling.
- The renderer has one React root, one route registry, and one reducer-backed workbook session.
- Renderer features depend on explicit ports and callbacks rather than preload globals or delegated DOM actions.
- Main, preload, and renderer build independently into `apps/mac/dist/`; packaging consumes built output instead of staging source files.
- Optional integrations remain above `finance-core` and cannot become prerequisites for the local finance workflow.
