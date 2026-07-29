# Cavalry Cloud

Status: implemented desktop MVP; Supabase project configuration and migration deployment are required before sign-in is available in a build.

## Product boundary

Cavalry Cloud is a local-first, multi-workbook library. A Google account identifies the user, but signing in never uploads a workbook. The user must choose **Add to Cloud** for each local workbook. Subsequent **Sync Now** actions append a new immutable cloud snapshot.

The MVP supports:

- Google OAuth through the system browser
- an OS-keychain-encrypted Supabase session in Electron main
- multiple workbooks per user
- explicit upload and revision-checked resync
- cloud workbook list, download/open, and confirmed deletion
- startup-screen sign-in and cloud library for a device with no local workbook
- immutable version history and append-only sync audit records
- owner-scoped Row Level Security

The MVP does not automatically merge changes from two devices. A stale upload
fails once with `workbook_revision_conflict` (`PT412` / HTTP 412); Cavalry never
retries with the remote revision because doing so could overwrite financial
changes. It keeps the last acknowledged revision and any conflict flag locally,
scoped to the signed-in user and workbook. A newer Cloud copy must be explicitly
reviewed, while a deleted Cloud copy can be deliberately re-added. Local files
remain authoritative and usable when Cloud is unavailable.

## Runtime flow

1. The Account settings route emits a cloud action.
2. The renderer cloud controller calls the narrow cloud port.
3. Preload invokes one named `cavalry-cloud:*` IPC handler.
4. Electron main owns Supabase Auth, tokens, PKCE verification, and network access.
5. Supabase RLS and the snapshot RPC authorize the user and enforce the expected revision.
6. The renderer receives only safe account/workbook metadata or a validated portable workbook.

OAuth codes and access/refresh tokens never enter the renderer. A fresh signed-out profile does not initialize credential storage during ordinary app startup. Cavalry accesses it only to restore a detected encrypted session or after the user explicitly begins sign-in. On macOS, Keychain may ask the user to approve that access, but Cavalry never receives the user's Mac password. If Electron cannot encrypt the session with the operating-system credential store, Cloud fails closed instead of writing plaintext credentials.

## Project setup

Apply the migrations in [`../../supabase/migrations/`](../../supabase/migrations/)
to the linked Supabase project, including
`20260726000100_fix_workbook_conflict_retry.sql`. Then:

1. Enable Google in Supabase Authentication providers.
2. Put the Google client ID and secret in Supabase—not in Cavalry.
3. Add `cavalry://auth/callback` as an exact Supabase redirect URL.
4. Add Supabase's project callback URL to the Google OAuth client.
5. Copy `apps/mac/.env.example` to the ignored `apps/mac/.env` and fill in the project URL and publishable key.
6. Add `CAVALRY_SUPABASE_URL` and `CAVALRY_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables for release builds.

Never place a Supabase secret/service-role key or Google OAuth secret in the desktop environment or GitHub variables used by the desktop build.

## Data and deletion

Each snapshot is the complete schema-v2 portable HTML workbook, limited to 25
MiB and hashed with SHA-256 in Postgres. Closed-beta owner quotas are enforced
inside the save transaction: 50 workbooks, 200 versions per workbook, 1,000
versions total, and 500 MiB of snapshots. Workbook metadata can be listed without
downloading financial contents. Cavalry stores only the user ID, workbook ID,
last acknowledged revision, and conflict flag locally for concurrency safety.
Removing a cloud workbook is an explicit privacy deletion that cascades its
snapshot history and audit records; it does not delete the local file.

See [`../../supabase/README.md`](../../supabase/README.md) for the database contract and deployment commands.

## Follow-up work

- device enrollment and revocation UI
- account export and deletion workflow
- version-history recovery UI and a product-facing quota/retention policy
- manual side-by-side conflict resolution
- background push/pull only after conflict UX and recovery guarantees are complete
