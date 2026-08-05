# Cavalry Cloud

Status: implemented desktop MVP; Supabase project configuration and migration deployment are required before sign-in is available in a build.

## Product boundary

Cavalry Cloud is a local-first, multi-workbook library. A Supabase user identified through Apple or Google owns the Cloud library, but signing in never uploads a workbook. The user must choose **Add to Cloud** for each local workbook. Subsequent **Sync Now** actions append a new immutable cloud snapshot.

The MVP supports:

- Apple and Google OAuth through the system browser
- explicit Apple identity linking for an existing signed-in Cloud account
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
`20260726000100_fix_workbook_conflict_retry.sql`. Then configure both apps against the same Supabase project:

1. Register the permanent iOS bundle identifier `com.juanmbuilder.cavalry.ios` as an Apple App ID with **Sign in with Apple** enabled as the primary identifier.
2. Create the Apple Services ID `com.juanmbuilder.cavalry.auth` for browser OAuth and associate it with that primary App ID.
3. In the Services ID, register `<project-ref>.supabase.co` as the domain and `https://<project-ref>.supabase.co/auth/v1/callback` as the Apple return URL.
4. Create a Sign in with Apple key tied to the primary App ID and generate the Services-ID client-secret JWT for Supabase web OAuth. Its `sub` is the Services ID. Store the `.p8` key outside the repositories and rotate the OAuth client secret before its six-month expiry.
5. Enable Apple in Supabase Authentication providers. In **Client IDs**, put the Services ID first and the native iOS bundle ID second. Web OAuth uses the first value; native iOS token validation accepts either listed audience.
6. Enable **Allow manual linking** in Supabase Auth so a signed-in Google user can connect Apple without creating a second Cloud owner. Supabase currently documents manual identity linking as beta, so test it against the exact production project before every auth release. Never merge users in a client by comparing email addresses.
7. Enable Google in Supabase Authentication providers and keep its client secret in Supabase.
8. Add `cavalry://auth/callback` as an exact Supabase redirect URL. Add Supabase's project callback URL to the Google OAuth client.
9. Copy `apps/mac/.env.example` to the ignored `apps/mac/.env` and fill in the project URL and publishable key.
10. Add `CAVALRY_SUPABASE_URL` and `CAVALRY_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables for release builds.

List every native bundle identifier that can produce an Apple token—including any separate development or preview identifier—in Supabase's Apple Client IDs after the Services ID. Do not configure Apple's server-to-server notification URL: Supabase Auth does not currently support that endpoint. The iOS client instead checks the stored native Apple credential on launch and foreground; that check clears only the local device session and does not revoke sessions on other devices.

Deploy `supabase/functions/delete-cavalry-account` before TestFlight. Store `APPLE_NATIVE_CLIENT_ID` and a separate native-client Apple secret JWT as Supabase function secrets, then rotate that JWT before its six-month maximum. The deletion JWT's `sub` is the native App ID (the iOS bundle ID), so it is not interchangeable with the Services-ID JWT used by Supabase web OAuth. The function authenticates the caller and attempts to verify a fresh Apple authorization code against the linked Apple subject and revoke the token. Per [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple), missing or failed Apple revocation never blocks deletion of Cavalry data and Auth; the response sets `manualAppleRevocationRequired: true` so the client can direct the user to Apple Account settings. The function prefers `SUPABASE_SECRET_KEYS["default"]` and temporarily falls back to the legacy `SUPABASE_SERVICE_ROLE_KEY`; neither credential may enter either client. See [Supabase's API-key migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

The Electron app uses Apple web OAuth, so it does not need a native Sign in with Apple entitlement and its stable `com.local.cavalry.mac` bundle identifier must not change. That identifier is a directly-distributed macOS bundle identifier, not an Apple App ID: it is never registered in Apple Developer and never appears in the Apple or Supabase Apple provider configuration, so it is deliberately excluded from the `com.juanmbuilder.*` identity namespace adopted for the iOS App ID and the Services ID. Only the primary iOS App ID and the Services ID form the Apple identity group; changing the desktop identifier would break updates for released installations without affecting shared Cloud identity. The same applies to `com.local.cavalry.windows`. Never place a Supabase secret/service-role key, provider client secret, Apple `.p8` key, or Apple client-secret JWT in either installed app, its environment, or desktop release variables.

Apple can return a private relay address when the user chooses Hide My Email. Supabase only auto-links provider identities when verified email addresses match, so an existing Google user should sign in with Google first and use **Connect Apple**. Both apps key ownership and RLS by the immutable Supabase user ID, never by email. Before production writes are enabled, sign in with the same Apple account on iOS and Mac and verify that both sessions resolve to the same Supabase user ID.

## Data and deletion

Each snapshot is the complete schema-v2 portable HTML workbook, limited to 25
MiB and hashed with SHA-256 in Postgres. Closed-beta owner quotas are enforced
inside the save transaction: 50 workbooks, 200 versions per workbook, 1,000
versions total, and 500 MiB of snapshots. Workbook metadata can be listed without
downloading financial contents. Cavalry stores only the user ID, workbook ID,
last acknowledged revision, and conflict flag locally for concurrency safety.
Removing a cloud workbook is an explicit privacy deletion that cascades its
snapshot history and audit records; it does not delete the local file.
The iOS **Delete Cloud account** flow invokes the authenticated server function,
which removes stored feedback objects and deletes the Auth user; database foreign
keys cascade all active owner-scoped Cavalry Cloud rows. Local workbook files are
outside that Cloud account and remain on each device.

See [`../../supabase/README.md`](../../supabase/README.md) for the database contract and deployment commands.

## Follow-up work

- device enrollment and revocation UI
- account export workflow
- version-history recovery UI and a product-facing quota/retention policy
- manual side-by-side conflict resolution
- background push/pull only after conflict UX and recovery guarantees are complete
