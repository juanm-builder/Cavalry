# Cavalry

Cavalry is a local-first personal finance application for macOS and Windows. The desktop product uses a React renderer inside **Tauri 2**, with a Rust host that owns native windowing, menus, deep links, updates, and a tightly scoped Cavalry host sidecar. The renderer, finance rules, workbook format, and visual design are shared with the previous desktop runtime.

> Cavalry organizes financial information. It does not provide financial, tax, legal, or investment advice.

## Repository map

- `apps/desktop/` — Tauri desktop application, React renderer, isolated host sidecar, native configuration, and app tests.
- `packages/` — platform-independent finance and workflow packages.
- `tools/` — architecture, release, security, and optional local-model tooling.
- `tests/architecture/` — repository-wide dependency and ownership checks.
- `examples/workbooks/` — sanitized workbook examples.
- `docs/` — architecture, development, feature, integration, migration, security, and release documentation.

The intended dependency direction is:

```text
Tauri shell / desktop adapters
        ↓
workflow and integration packages
        ↓
@cavalry/finance-core
```

`@cavalry/finance-core` stays independent of Tauri, Node, filesystems, provider SDKs, React, and browser globals. Privileged behavior is reached through injected renderer ports rather than direct access to native APIs.

## Desktop architecture

The desktop app has three runtime layers:

1. **React renderer** — the existing interface, routes, workbook session, feature controllers, and CSS.
2. **Rust/Tauri host** — the native window, application menu, single-instance behavior, `cavalry://` deep links, updater, lifecycle, and the bounded IPC bridge.
3. **Cavalry host sidecar** — existing Node services for workbook persistence and recovery, Cavalry Cloud, Companion API, Advisor streaming, transcription, and llama.cpp process supervision.

The sidecar is an intentional compatibility boundary, not renderer-accessible Node integration. Only the Rust host can launch it. Requests use a versioned newline-delimited protocol, named channels, input-size limits, request timeouts, and Tauri events.

## Local setup

Requirements:

- Node.js 22
- npm
- Rust stable
- stable Rust toolchain with `tauri-cli` 2.11.4 installed (`cargo install tauri-cli --version 2.11.4 --locked`)
- platform prerequisites from the Tauri documentation

From the repository root:

```bash
npm ci
npm run dev
```

`npm run dev` builds the Node host bundle and starts the pinned Tauri CLI. The renderer is served by Vite and retains hot reload.

## Validation

```bash
npm run check
npm run test:integration
npm run test:e2e
npm run verify:architecture
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Native packaging also requires a target-specific sidecar. The package commands prepare it automatically:

```bash
npm run package:mac
npm run package:mac:intel
npm run package:windows
```

Release builds additionally require operating-system signing credentials and Tauri updater keys. See [the release guide](docs/operations/release.md).

## Privacy and safety

The primary workbook workflow is local-first. Optional Cloud, remote Advisor providers, voice transcription, and Companion integrations can transmit selected information only when configured and used. Read [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) before testing with sensitive data.

Never publish a real workbook, credentials, account details, model keys, private tunnel addresses, or unredacted diagnostics. Use synthetic fixtures in issues and tests.

## Documentation

- [Documentation index](docs/README.md)
- [Desktop source map](apps/desktop/README.md)
- [Architecture](docs/architecture/README.md)
- [Development workflow](docs/development/README.md)
- [Electron-to-Tauri migration](docs/operations/electron-to-tauri-migration.md)
- [Native certification checklist](docs/operations/native-certification.md)
- [Release process](docs/operations/release.md)
- [Security model](docs/operations/security.md)
- [Migration status](MIGRATION_STATUS.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Cavalry project code is licensed under the [Apache License 2.0](LICENSE). Third-party dependencies, institution logos, and trademarks remain subject to their own terms.
