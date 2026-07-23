# Contributing to Cavalry

Thank you for helping improve Cavalry. Small, focused changes with clear tests are the easiest to review.

Participation in this repository is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Do not use a public issue or pull request to disclose a vulnerability, credential, financial record, or other sensitive data; follow [SECURITY.md](SECURITY.md) instead.

## Before starting

Search existing issues and pull requests before opening a duplicate. For a substantial feature, public contract change, schema migration, or new external service, open an issue first so the boundary and compatibility impact can be discussed.

Keep each change inside the boundary that owns it. Reusable finance rules belong in workspace packages; Electron, filesystem, process, network, DOM, and React behavior belongs in the desktop app adapter. Cross-package imports must use public export-map paths. Preserve the current product structure and user-data contracts unless the proposal explicitly includes a reviewed migration.

## Local setup

Use Node 22 and install from the repository root:

```bash
npm ci
npm run dev
```

Do not commit a real workbook, credentials, local models, generated builds, package output, logs, or test artifacts. Fixtures must be synthetic and intentionally curated.

## Validation

Before handoff, run:

```bash
npm run check
npm run test:integration
npm run test:e2e
git diff --check
```

`npm run check` is required. Run the integration and E2E gates when the change reaches their boundaries; document any gate that was intentionally not run. Renderer changes should use interaction tests, package mutations should assert the standard immutable command-result contract, and IPC/native-file changes should cover the adapter and Electron contract.

When production dependencies or `package-lock.json` change, run `npm run licenses:runtime` and commit the refreshed runtime dependency notice. The normal check rejects a missing, incomplete, or stale notice.

## Pull requests

Keep formatting-only or generated changes separate from behavior changes. A pull request should describe:

- the user-visible outcome and why it is needed;
- the owning boundaries and public contracts affected;
- the tests and manual checks run;
- screenshots only when they help verify an existing interface behavior; and
- known limitations or follow-up work.

Review your diff for secrets, personal paths, real data, and accidental build output before pushing. Maintainers may ask for a smaller change or additional regression coverage.

## Contribution license

Unless you explicitly state otherwise, a contribution intentionally submitted for inclusion in Cavalry is licensed under the project's [Apache License 2.0](LICENSE), consistent with section 5 of that license. You must have the right to submit the contribution. Identify any third-party code or assets and preserve their required notices.

See the [development guide](docs/development/README.md), [architecture map](docs/architecture/README.md), and [detailed contribution policy](docs/development/contributing.md).
