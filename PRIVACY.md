# Privacy and data handling

Last updated: 2026-08-28

Cavalry is local-first, but optional features can send selected data to external services. This document describes the current repository behavior; it does not replace the privacy terms of Apple, GitHub, OpenAI, a configured model provider, or a tunnel provider.

## Local workbook data

Workbook contents are stored in the portable file you create or open. Cavalry may also keep local application cache, recent-file paths, settings, temporary save files, and rolling backups so the desktop workflow can recover and reopen work. These files can contain financial data or reveal where a workbook is stored. Protect the operating-system account and device backups, and securely remove copies that are no longer needed.

The Notes workspace keeps unfinished note text in local application storage,
scoped to the current workbook, so it can be restored after navigation or an app
restart. Processing Notes locally uses deterministic parsing. If optional AI
processing is selected, the note lines and the active account and category
choices needed to resolve them are sent through the configured Advisor provider.

The current code does not configure a general product-analytics or advertising service. A packaged app still makes ordinary network requests for update checks and the Material Symbols font stylesheet, and optional features add the requests described below.

## iCloud workbook sync

iCloud sync is optional and uses the private CloudKit database belonging to the Apple Account signed in on the device. Cavalry saves locally first, then queues a validated portable HTML workbook snapshot together with its name, year, currency, revision, update time, and integrity hash. CloudKit receives the account and network information needed to provide the service. Cavalry does not operate a separate sync account and does not receive an Apple Account password.

CloudKit metadata and the workbook asset use encrypted record fields. Cavalry also keeps CloudKit change tokens, record system fields, pending payloads, cached remote payloads, revision anchors, and conflict flags in local Application Support storage so offline changes can resume safely. These local files can contain financial data and should be protected like the primary workbook.

To prevent stale copies from silently overwriting newer ones, Cavalry compares the last acknowledged revision and CloudKit record change tag. A conflict remains blocked until the user explicitly reviews the iCloud copy or confirms a local replacement against the latest remote revision.

Deleting an iCloud workbook removes its private CloudKit record when the queued deletion reaches Apple; it does not delete the local workbook. Signing out of or switching the device's Apple Account clears Cavalry's local CloudKit cache and change tokens but does not delete local workbooks. Apple's infrastructure and backup-retention policies may continue to apply.

See [iCloud workbook sync](docs/features/icloud-sync.md) for the maintained product and data boundary.

## Companion local memory

Companion personalization is optional and stored in a transparent `memory.md` file in Cavalry's
local application-data directory. It is separate from the portable workbook and saved chat history,
is disabled when first created, and is not uploaded by Cavalry Cloud. The Companion settings surface
shows the full path and provides separate controls to open the file, open its folder, and reload it.
You may also edit the Markdown file with another application.

The file can contain free-form background context and structured records. A structured record has a
stable local ID, text, optional tags, an `always` or `relevant` scope, and created/updated timestamps.
Settings and explicit chat actions can create, update, and delete individual records. Clear memory
removes the remembered content and records after confirmation but does not delete the workbook or
chat history. Ordinary conversation is not silently converted into long-term memory. Chat-based
remember/update/forget actions also require the separate **Allow approved updates from chats**
preference.

Memory writes are serialized and use a temporary file plus rename so a failed write does not replace
the last complete document. Cavalry hashes the document as a revision. If the file changed after an
in-app edit began, a revision-checked write reports a conflict and asks you to reload rather than
overwriting the external edit. Cavalry rereads the file when settings refresh and before preparing a
model request, so external edits can take effect without an app restart. The file has a 64 KB limit.
Malformed front matter is reported in settings and is not added to model requests or silently
overwritten by ordinary memory actions.

When memory is enabled, Cavalry selects a bounded, relevance-ranked portion for the current request.
Records marked `always` are prioritized; other records are selected from tag and text overlap with
recent user messages. The injected context is capped and labeled as user-controlled background, not
as instructions, financial evidence, or authorization to take an action. Disabling memory prevents
this context from being added.

If the configured Advisor endpoint is OpenAI or another remote/custom network service, the selected
memory context is sent to that endpoint with the request and is governed by that service's retention
and training terms. A custom endpoint can be local or remote, so verify its URL. Memory remains in
the local file until you edit or clear it; Cavalry does not provide a separate memory sync service.

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
