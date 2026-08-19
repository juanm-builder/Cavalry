# Contributing to Cavalry

Thank you for helping improve Cavalry. Focused changes with clear ownership, compatibility notes, and tests are easiest to review.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Do not use a public issue or pull request to disclose a vulnerability, credential, financial record, or other sensitive information; follow [SECURITY.md](SECURITY.md).

## Before starting

Search existing issues and pull requests. Open an issue before a substantial feature, schema migration, new external service, updater change, or native compatibility change.

Choose the owning layer before editing:

- finance and workbook semantics: `packages/finance-core`
- review/checkpoint behavior: `packages/action-review`
- Advisor orchestration: `packages/advisor`
- Companion API contracts/server adapters: `packages/companion-api`
- sync/conflict rules: `packages/sync-foundation`
- React product and desktop adapters: `apps/desktop/src/renderer`
- native lifecycle and sidecar supervision: `apps/desktop/src-tauri`
- privileged compatibility services: `apps/desktop/src/host`

Cross-package imports must use public export-map paths. Feature code must not import Tauri globals, Node built-ins, Rust sources, or host modules.

## Local setup

Install Node 22, npm 10, the stable Rust toolchain, and native Tauri prerequisites, then run:

```bash
npm ci
npm run licenses:runtime
npm run dev
```

Fixtures must be synthetic. Never commit a real workbook, credential, local model, user-data directory, generated sidecar, installer, signing material, or diagnostic log containing private data.

## Validation

Before handoff:

```bash
npm run verify:architecture
npm run check
npm run test:integration
npm run test:e2e
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
git diff --check
```

Run native packaging and the relevant sections of the [native certification checklist](docs/operations/native-certification.md) when a change affects WebView behavior, files, menus, deep links, permissions, secure storage, child processes, signing, installers, or updates.

When `package-lock.json` changes, regenerate the runtime inventory with `npm run licenses:runtime`. Do not commit the generated inventory; CI and packaging reproduce and verify it from the lockfile.

## Pull requests

Describe:

- the user-visible outcome and reason
- the owning boundaries and public contracts affected
- compatibility or migration impact
- automated and manual checks completed
- screenshots when they help verify an existing interface
- known limitations and follow-up work

Keep formatting-only and generated changes separate from behavior changes where practical. Review the final diff for secrets, personal paths, real data, stale platform references, and build output.

## Contribution license

Unless explicitly stated otherwise, a contribution intentionally submitted for inclusion in Cavalry is licensed under the project's [Apache License 2.0](LICENSE), consistent with section 5 of that license. You must have the right to submit it and must identify third-party code or assets with required notices.
