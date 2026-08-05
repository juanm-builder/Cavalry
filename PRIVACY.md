# Privacy and data handling

Last updated: 2026-08-04

Cavalry is local-first, but optional features can send selected data to external services. This document describes the current repository behavior; it does not replace the privacy terms of Apple, Supabase, Google, GitHub, OpenAI, a configured model provider, or a tunnel provider.

## Local workbook data

Workbook contents are stored in the portable file you create or open. Cavalry may also keep local application cache, recent-file paths, settings, temporary save files, and rolling backups so the desktop workflow can recover and reopen work. These files can contain financial data or reveal where a workbook is stored. Protect the operating-system account and device backups, and securely remove copies that are no longer needed.

The Notes workspace keeps unfinished note text in local application storage,
scoped to the current workbook, so it can be restored after navigation or an app
restart. Processing Notes locally uses deterministic parsing. If optional AI
processing is selected, the note lines and the active account and category
choices needed to resolve them are sent through the configured Advisor provider.

The current code does not configure a general product-analytics or advertising service. A packaged app still makes ordinary network requests for update checks and the Material Symbols font stylesheet, and optional features add the requests described below.

## Cavalry Cloud

Cavalry Cloud is optional and requires a configured Supabase project. Apple or Google can authenticate the same owner-scoped account. Signing in does not upload a workbook. **Add to Cloud** and later **Sync Now** actions upload a complete portable HTML workbook snapshot to Supabase, together with workbook metadata, a content hash, version history, and sync audit records. The chosen identity provider and Supabase receive the account and network data needed to authenticate and serve those requests. Apple may provide a private relay address when **Hide My Email** is selected. On iPhone and iPad, Cavalry stores Apple's stable credential identifier in device-only Keychain storage so it can check that credential on launch and foreground; this identifier is not an Apple password or token.

Cloud sessions are stored through the operating system's credential encryption. A fresh signed-out profile does not access credential storage merely because Cavalry starts; secure storage initializes only to restore an existing encrypted session or after the user explicitly begins sign-in. On macOS, Keychain may ask the user to approve that access, but Cavalry never receives the user's Mac password. If secure storage is unavailable, Cloud fails closed instead of persisting plaintext tokens. Cloud snapshots are protected by owner-scoped Row Level Security, but users should still treat the configured Supabase project as a holder of their financial data.

To prevent a stale local copy from silently overwriting a newer Cloud copy,
Cavalry stores the signed-in user ID, workbook ID, last acknowledged Cloud
revision, and conflict flag in local application storage. This sync marker does
not contain workbook contents, account balances, transactions, or Cloud tokens.

Deleting a cloud workbook removes its cloud snapshots and related audit records under the current database contract; it does not delete the local workbook. The iOS Cloud screen also provides **Delete Cloud account**. After confirmation—and fresh Apple confirmation when Apple is connected—the trusted Supabase function removes feedback attachments, deletes the Supabase Auth user, and cascades the user's active Cloud profile, workbook snapshots, versions, feedback metadata, and audit records. It also asks Apple's server to revoke the connected Apple token before deleting an Apple-backed account. Local workbook files on the user's devices are not deleted. Provider and infrastructure backup-retention rules may continue to apply; a self-service account export is not currently implemented.

See [Cavalry Cloud](docs/features/cavalry-cloud.md) for the maintained product and data boundary.

## Advisor providers and local models

Advisor is optional. When a remote provider or custom network endpoint is configured, prompts, relevant workbook facts, conversation content, and user-selected images needed for the request are sent to that endpoint. The provider's own retention and training terms apply. Use only providers and endpoints you trust.

Advisor API keys remain in the privileged desktop process. Saved keys use operating-system encryption when available; if the app cannot safely recover an encrypted or legacy key, it clears or rejects it rather than intentionally persisting plaintext.

A user-selected llama.cpp server and GGUF model can run on the local machine. Cavalry does not bundle model weights. A custom endpoint may be local or remote, so verify its URL before sending real workbook information.

## Microphone and voice input

Cavalry requests operating-system microphone permission only when voice input is used. The recorded audio is sent to OpenAI's transcription API using the configured OpenAI API key and is replaced in the composer by the returned text. Do not use voice input if the recording should remain entirely on the device. OpenAI's terms and privacy practices govern that transcription request.

## Companion API and tunnels

The Companion API is disabled by default and normally binds to localhost. If explicitly enabled, it can expose scoped workbook summaries, account or category lists, recent transaction snippets, draft descriptions, and review identifiers to an authorized client.

The beta tunnel mode gives that local API a temporary public HTTPS address. Data then passes through the chosen tunnel provider and the connected client, such as a Custom GPT. Anyone who obtains both the URL and token may be able to reach the enabled API while it is running. Stop the tunnel after use, rotate exposed tokens, and test with synthetic data first.

Companion audit events record operational metadata such as request IDs, scopes, operation IDs, action counts, timestamps, and outcomes. The maintained contract excludes access tokens, raw request bodies, and raw action plans from those audit events. See the [Companion security guide](docs/operations/companion-api-security.md) and [beta privacy guide](docs/operations/companion-api-power-user-beta-privacy.md).

## Local logs and diagnostics

The optional local llama.cpp launcher writes a log in Cavalry's application-data directory. It can contain timestamps, local binary or model paths, process output, and error details. Other development commands and operating-system crash facilities may produce their own logs. Cavalry does not automatically attach these files to GitHub issues.

Review and redact every diagnostic file before sharing it. File paths, prompts, provider responses, account names, and transaction details can be sensitive even when credentials are masked.

## Questions and disclosure

Open a public issue only when the question can be described without personal or financial information. Report leaked credentials, unintended data exposure, or a security weakness through the private process in [SECURITY.md](SECURITY.md). Revoke or rotate an exposed credential immediately; do not wait for an issue response.
