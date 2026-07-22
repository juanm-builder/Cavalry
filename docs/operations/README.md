# Operations

- [`security.md`](security.md) — vulnerability reporting and secret/data handling.
- [`artifacts.md`](artifacts.md) — generated and tracked artifact policy.
- [`ci.md`](ci.md) — CI gates and triggers.
- [`release.md`](release.md) — signed desktop packaging, GitHub draft releases, publication, and end-to-end updater testing.
- [`public-repository.md`](public-repository.md) — one-time public-source publication and updater-transition checklist.
- [`companion-api-security.md`](companion-api-security.md) — Companion API threat boundary.

Local packaging remains ad-hoc and non-publishing. Tag-triggered production releases currently require macOS signing/notarization, prepare a macOS-only public GitHub draft, and wait for an explicit maintainer publish action before updater clients can see it. Windows release support remains dormant until its signing workflow is deliberately enabled.
