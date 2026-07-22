# Cavalry

Cavalry is a local-first desktop finance app for macOS and Windows. The repository is an npm workspace with the Electron product under the historically named `apps/mac/` workspace, reusable domain and workflow packages under `packages/`, and supporting developer tools under `tools/`.

## Project status

Cavalry is under active development. The public repository is available for review, issue reporting, and focused contributions; a public source tree is not a guarantee that every experimental integration is ready for production use. Review the [changelog](CHANGELOG.md) and maintained feature documentation before relying on a release.

Cavalry organizes user-provided financial information but does not provide financial, tax, legal, or investment advice.

## Workspace map

- `apps/mac/` — Electron main process, preload bridge, renderer, app tests, and packaging configuration.
- `packages/` — platform-independent finance and workflow packages.
- `tools/` — repository tooling and the optional llama.cpp launcher.
- `examples/workbooks/` — sanitized portable-workbook examples.
- `tests/architecture/` — repository-wide dependency and ownership guardrails.
- `docs/` — maintained architecture, development, feature, integration, operations, and ADR documentation.

The dependency direction is `apps/mac` → workflow/integration packages → `finance-core`. `finance-core` is platform-independent; Electron, filesystem, process, network, DOM, and React APIs stay in their owning adapters.

The renderer has one React root and one executable route registry. A reducer-backed workbook session owns hydration, immutable workbook state, save state, navigation, overlays, warnings, and errors. Feature controllers consume explicit storage, cache, Advisor, Companion, clock, ID, fingerprint, download, and file-picker ports instead of reading preload globals directly.

## Privacy and safety

The core workbook workflow is local-first. Optional Cavalry Cloud, remote Advisor providers, voice transcription, and Companion tunnel features can transmit selected data when a user configures and invokes them. Read [PRIVACY.md](PRIVACY.md) for the current data boundary and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Never attach a real workbook, credentials, account details, or unredacted logs to a public issue. Use synthetic examples when reporting a problem.

## Develop

Use Node 22 and run commands from the repository root:

```bash
npm ci
npm run dev
```

Before handing off a change, run the full static, build, and unit gate. Add integration or Electron E2E coverage when the changed boundary requires it:

```bash
npm run check
npm run test:integration
npm run test:e2e
```

Build the ad-hoc Apple-silicon package with `npm run package:mac`. Build the otherwise identical Intel package with `npm run package:mac:intel`. Current production macOS packages are signed and notarized by the tag-only release workflow. Windows packaging and updater support remain available for a future signed rollout but are not part of the current release channel; see [`docs/operations/release.md`](docs/operations/release.md).

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution and validation workflow.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — community participation expectations.
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting and security invariants.
- [`PRIVACY.md`](PRIVACY.md) — current local and optional network data handling.
- [`SUPPORT.md`](SUPPORT.md) — safe support and issue-reporting guidance.
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — dependency and asset attributions.
- [`CHANGELOG.md`](CHANGELOG.md) — user-visible and compatibility-relevant changes.
- [`docs/README.md`](docs/README.md) — documentation index.
- [`docs/architecture/README.md`](docs/architecture/README.md) — current workspace boundaries and dependency direction.
- [`docs/development/README.md`](docs/development/README.md) — contributor workflow and root commands.
- [`docs/operations/README.md`](docs/operations/README.md) — security and release guidance.
- [`apps/mac/README.md`](apps/mac/README.md) — Electron desktop app source map.

Advisor providers, Companion API/Custom GPT access, checkpointed external apply, Cavalry Cloud, and the llama.cpp launcher are optional unless a current feature document says otherwise. Cavalry Cloud currently provides explicit revision-checked workbook snapshots; automatic two-way merge and hosted Companion infrastructure remain intentionally deferred. Signing, notarization, and updater publication apply only to production release packages; local builds stay non-publishing.

## License

Cavalry project code is licensed under the [Apache License 2.0](LICENSE). Third-party dependencies, institution logos, and trademarks remain subject to their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
