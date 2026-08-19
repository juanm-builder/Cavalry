# Companion API Local Dev

The local Companion API is off by default. Start it only for local testing or certification.

Local/dev environment:

```sh
export CAVALRY_COMPANION_API_ENABLED=1
export CAVALRY_COMPANION_API_MODE=local_dev
export CAVALRY_COMPANION_DEV_TOKEN=dev-token
export CAVALRY_COMPANION_BIND_HOST=127.0.0.1
```

Guardrails:

- Default host is `127.0.0.1`.
- Public binds require `CAVALRY_COMPANION_ALLOW_PUBLIC_BIND=1`.
- Dev or beta bearer auth is required outside tests.
- The server logs a warning when enabled.
- A local-only server is not directly reachable by a normal Custom GPT in production.

Useful commands:

```sh
npm run openapi:validate --workspace @cavalry/companion-api
npm run openapi:action-sanity --workspace @cavalry/companion-api
npm test --workspace @cavalry/companion-api
npm run test:integration --workspace @cavalry/companion-api
npm run gpt-action:certify --workspace @cavalry/companion-api
```

Live app bridge:

```sh
export CAVALRY_COMPANION_API_ENABLED=1
export CAVALRY_COMPANION_API_MODE=local_dev
export CAVALRY_COMPANION_DEV_TOKEN=dev-token
npm run dev
```

When the Tauri desktop app is running, the Companion API uses the workbook currently open in the UI. `/v1/workbooks` should list that workbook, and draft creation should add reviewable AI Drafts without posting transactions.

The certification report is written to `test-artifacts/companion-gpt-action-certification/report.md` and `report.json` at the repository root.
