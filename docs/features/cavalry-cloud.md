# Cavalry Cloud

Status: implemented on Mac and iOS; Supabase project configuration and migration
deployment are required before sign-in is available in a build.

Use the [Cavalry Cloud OAuth release runbook](./cavalry-cloud-oauth-runbook.md)
for the exact Apple, Google, Supabase, GitHub Actions, EAS, and cross-app release
checks. It is the canonical operational checklist; this document describes the
product and runtime boundary.

## Product boundary

Cavalry Cloud is a local-first, multi-workbook library. A Supabase user
identified through Apple or Google owns the Cloud library, while each client
keeps a usable local copy and sends complete, revision-checked snapshots to
Cloud.

On Mac, signing in alone neither uploads nor replaces the open workbook.
**Add to Cloud** provides an explicit first upload and **Open** deliberately
replaces the current workbook after its backing file is safe. While signed in,
each successful local save also enters a debounced automatic sync; that save can
create the matching Cloud workbook when none exists. Transient automatic-sync
retries are kept in memory while the app remains open.

On iOS, complete workbook records and their sync metadata live in plain SQLite.
Every successful finance command is saved there before the interface reports
success, and the persisted dirty state drives debounced sync after reconnecting,
returning to the foreground, or relaunching. A fresh install adopts the sole
existing Cloud workbook. If the owner has multiple Cloud workbooks, the new
blank workbook stays local-only until the user chooses or edits it; with no
Cloud workbook, reconciliation allows the initial local workbook to upload.

The MVP supports:

- Google OAuth through the system browser, Apple browser OAuth on Mac, and
  native Apple authentication on iOS
- explicit Apple identity linking for an existing signed-in Cloud account
- an OS-protected encrypted Supabase session in the isolated desktop host and a
  Keychain-backed native Supabase session on iOS
- multiple workbooks per user
- local-first persistence plus debounced, revision-checked snapshot sync
- cloud workbook list, download/open, and confirmed deletion
- iOS first-boot reconciliation with zero, one, or multiple Cloud workbooks
- immutable version history and append-only sync audit records
- owner-scoped Row Level Security
- active Mac and iOS Realtime subscriptions to owner-authorized workbook
  metadata only

Neither client performs a field-level or automatic two-way merge. A stale
upload fails with `workbook_revision_conflict` (`PT412` / HTTP 412); automatic
sync never retries with the remote revision because doing so could overwrite
financial changes. Both clients keep a last-acknowledged revision and latch a
conflict when local work is dirty or pending while Cloud advances.

When a newer Realtime revision arrives and the current workbook is clean, Mac
downloads and safely writes the newer snapshot to its file/cache, while iOS
downloads, validates, and persists it to SQLite. A Mac conflict remains latched
until the current local workbook is safely saved and the user explicitly opens
the Cloud copy. iOS offers two explicit snapshot choices: **Use Cloud** replaces
the local SQLite record with the validated Cloud snapshot, while **Keep Local**
re-reads the current Cloud revision and submits the chosen local snapshot with
that exact compare-and-swap anchor. Neither choice merges individual fields.

The Realtime migration publishes only `public.workbooks`. Mac subscribes to the
signed-in owner's workbook metadata; iOS subscribes to the active linked
workbook. Both treat changes only as invalidation signals. Realtime does not
publish `workbook_versions` or portable snapshot contents, and an event does not
grant write authority. Clients must still list or download through the
owner-scoped contract, validate the portable workbook, and save with the exact
acknowledged revision. Realtime delivery is not an offline queue and never
authorizes an automatic conflict overwrite.

## Mac runtime flow

1. The Account settings route emits a cloud action.
2. The renderer cloud controller calls the narrow cloud port.
3. The renderer bridge invokes one named `cavalry-cloud:*` IPC handler.
4. The isolated desktop host owns Supabase Auth, tokens, PKCE verification, and network access.
5. Supabase RLS and the snapshot RPC authorize the user and enforce the expected revision.
6. The renderer receives only safe account/workbook metadata or a validated portable workbook.
7. Successful local saves enqueue a debounced snapshot upload; Realtime metadata
   refreshes the library and pulls only when the current workbook is clean.

OAuth codes and access/refresh tokens never enter the renderer. A fresh signed-out profile does not initialize credential storage during ordinary app startup. Cavalry accesses it only to restore a detected encrypted session or after the user explicitly begins sign-in. On macOS, Keychain may ask the user to approve that access, but Cavalry never receives the user's Mac password. If the desktop host cannot encrypt the session with the operating-system credential store, Cloud fails closed instead of writing plaintext credentials.

## iOS runtime flow

1. `WorkspaceProvider` loads the active workbook and workbook list from SQLite.
2. A finance command is validated and saved locally before its promise resolves.
3. The persisted dirty flag schedules a debounced Cloud save after owner and
   workbook reconciliation.
4. The Supabase repository lists metadata, downloads validated snapshots, and
   saves with the current compare-and-swap revision.
5. Realtime metadata pulls a newer clean revision or latches a dirty conflict.
6. Explicit conflict resolution either persists the validated Cloud snapshot or
   saves the selected local snapshot against a freshly read Cloud revision.

Signing out or changing owners does not delete local SQLite workbooks. Supabase
tokens and provider credentials do not enter workbook storage.

## Project setup

Apply the migrations in [`../../supabase/migrations/`](../../supabase/migrations/)
to the linked Supabase project, including
`20260726000100_fix_workbook_conflict_retry.sql` and
`20260816000100_enable_workbook_realtime.sql`. Then configure both apps against
the same Supabase project:

1. Register the permanent iOS bundle identifier `com.juanmbuilder.cavalry.ios` as an Apple App ID with **Sign in with Apple** enabled as the primary identifier.
2. Create the Apple Services ID `com.juanmbuilder.cavalry.auth` for browser OAuth and associate it with that primary App ID.
3. In the Services ID, register `<project-ref>.supabase.co` as the domain and `https://<project-ref>.supabase.co/auth/v1/callback` as the Apple return URL.
4. Create a Sign in with Apple key tied to the primary App ID and generate the Services-ID client-secret JWT for Supabase web OAuth. Its `sub` is the Services ID. Store the `.p8` key outside the repositories and rotate the OAuth client secret before its six-month expiry.
5. Enable Apple in Supabase Authentication providers. In **Client IDs**, put the Services ID first and the native iOS bundle ID second. Web OAuth uses the first value; native iOS token validation accepts either listed audience.
6. Enable **Allow manual linking** in Supabase Auth so a signed-in Google user can connect Apple without creating a second Cloud owner. Supabase currently documents manual identity linking as beta, so test it against the exact production project before every auth release. Never merge users in a client by comparing email addresses.
7. Enable Google in Supabase Authentication providers and keep its client secret in Supabase.
8. Add `cavalry://auth/callback` as an exact Supabase redirect URL. Add Supabase's project callback URL to the Google OAuth client.
9. Copy `apps/desktop/.env.example` to the ignored `apps/desktop/.env` and fill in the project URL and publishable key.
10. Add `CAVALRY_SUPABASE_URL` and `CAVALRY_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables for release builds.

List every native bundle identifier that can produce an Apple token—including any separate development or preview identifier—in Supabase's Apple Client IDs after the Services ID. Do not configure Apple's server-to-server notification URL: Supabase Auth does not currently support that endpoint. The iOS client instead checks the stored native Apple credential on launch and foreground; that check clears only the local device session and does not revoke sessions on other devices.

Deploy `supabase/functions/delete-cavalry-account` before TestFlight. Store `APPLE_NATIVE_CLIENT_ID` and a separate native-client Apple secret JWT as Supabase function secrets, then rotate that JWT before its six-month maximum. The deletion JWT's `sub` is the native App ID (the iOS bundle ID), so it is not interchangeable with the Services-ID JWT used by Supabase web OAuth. The function authenticates the caller and attempts to verify a fresh Apple authorization code against the linked Apple subject and revoke the token. Per [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple), missing or failed Apple revocation never blocks deletion of Cavalry data and Auth; the response sets `manualAppleRevocationRequired: true` so the client can direct the user to Apple Account settings. The function prefers `SUPABASE_SECRET_KEYS["default"]` and temporarily falls back to the legacy `SUPABASE_SERVICE_ROLE_KEY`; neither credential may enter either client. See [Supabase's API-key migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

The Tauri desktop app uses Apple web OAuth, so it does not need a native Sign in with Apple entitlement and its stable `com.local.cavalry.mac` bundle identifier must not change. That identifier is a directly-distributed macOS bundle identifier, not an Apple App ID: it is never registered in Apple Developer and never appears in the Apple or Supabase Apple provider configuration, so it is deliberately excluded from the `com.juanmbuilder.*` identity namespace adopted for the iOS App ID and the Services ID. Only the primary iOS App ID and the Services ID form the Apple identity group; changing the desktop identifier would break updates for released installations without affecting shared Cloud identity. The same applies to `com.local.cavalry.windows`. Never place a Supabase secret/service-role key, provider client secret, Apple `.p8` key, or Apple client-secret JWT in either installed app, its environment, or desktop release variables.

Apple can return a private relay address when the user chooses Hide My Email. Supabase only auto-links provider identities when verified email addresses match, so an existing Google user should sign in with Google first and use **Connect Apple**. Both apps key ownership and RLS by the immutable Supabase user ID, never by email. Before production Cloud sync ships, sign in with the same Apple account on iOS and Mac and verify that both sessions resolve to the same Supabase user ID.

## Data and deletion

Each snapshot is the complete schema-v2 portable HTML workbook, limited to 25
MiB and hashed with SHA-256 in Postgres. Closed-beta owner quotas are enforced
inside the save transaction: 50 workbooks, 200 versions per workbook, 1,000
versions total, and 500 MiB of snapshots. Workbook metadata can be listed without
downloading financial contents. Cavalry stores only the user ID, workbook ID,
last acknowledged revision, and conflict flag in the Mac Cloud sync-state store;
the actual local Mac workbook remains in its file or app cache. iOS stores
complete local workbooks plus Cloud link, dirty, revision, and conflict metadata
in its SQLite workbook store.

Removing a cloud workbook is an explicit privacy deletion that cascades its
snapshot history and audit records; it does not delete the local workbook on
either platform.
The iOS **Delete Cloud account** flow invokes the authenticated server function,
which removes stored feedback objects and deletes the Auth user; database foreign
keys cascade all active owner-scoped Cavalry Cloud rows. Local workbooks are
outside that Cloud account and remain on each device.

See [`../../supabase/README.md`](../../supabase/README.md) for the database contract and deployment commands.

## Follow-up work

- device enrollment and revocation UI
- account export workflow
- version-history recovery UI and a product-facing quota/retention policy
- richer side-by-side or field-level conflict resolution
- a durable desktop automatic-sync queue that survives an app restart
