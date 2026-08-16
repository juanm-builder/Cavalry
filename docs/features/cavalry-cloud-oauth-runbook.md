# Cavalry Cloud OAuth release runbook

Use this checklist for every production or TestFlight auth release. Cavalry for
Mac and Cavalry Mobile must use one Supabase project and one Apple identity
group so ownership always resolves through the same immutable Supabase user ID.
Do not merge accounts by email address.

No provider client secret, Apple signing key, Apple client-secret JWT, Supabase
secret key, service-role key, access token, or refresh token belongs in either
repository, installed app, public Expo variable, or desktop release variable.

## Fixed application identifiers and callbacks

- iOS App ID and bundle identifier: `com.juanmbuilder.cavalry.ios`.
- Apple Services ID for browser OAuth: `com.juanmbuilder.cavalry.auth`.
- Installed-app callback: `cavalry://auth/callback`.
- Provider callback: `https://<project-ref>.supabase.co/auth/v1/callback`.
- The desktop `com.local.cavalry.mac` and `com.local.cavalry.windows` package
  identifiers are not Apple identities and must not be added to the Apple
  provider configuration.

Treat these values as release contracts. A change requires an identity and
account-migration plan, not only an app-config edit.

## Apple Developer actions

1. Register the exact iOS App ID and enable **Sign in with Apple**. Keep it as
   the primary App ID for the Cavalry identity group.
2. Register the Services ID, associate it with that primary App ID, and configure
   `<project-ref>.supabase.co` plus the exact Supabase provider callback above.
3. Create a Sign in with Apple key tied to the primary App ID. Keep the `.p8`
   file in protected operational storage.
4. Generate and calendar rotation for two separate client-secret JWTs:
   - the Services-ID JWT used by Supabase browser OAuth;
   - the native-App-ID JWT used only by `delete-cavalry-account` to exchange and
     revoke a fresh native authorization code.
5. Leave the Apple server-to-server notification URL blank while Supabase Auth
   does not support it.

## Google Cloud actions

1. Configure the OAuth consent screen for the intended production audience and
   publish it, or explicitly maintain the release test-user list while it
   remains in testing mode.
2. Create or select the web OAuth client used by Supabase Auth.
3. Add only the exact Supabase provider callback above to that client's
   authorized redirect URIs. The installed-app `cavalry://` callback does not go
   in Google Cloud; Supabase redirects to it after completing provider OAuth.
4. Store the Google client ID and secret only in the Supabase provider settings.

## Supabase Dashboard and deployment actions

1. Link the desktop repository's `supabase/` directory to the production project
   and apply every forward-only migration, including the workbook Realtime
   publication migration. Do not edit an already-applied migration.
2. Enable Google and Apple under Authentication providers.
3. Configure Apple Client IDs in this exact order:
   1. `com.juanmbuilder.cavalry.auth` (Services ID for browser OAuth);
   2. `com.juanmbuilder.cavalry.ios` (native production App ID);
   3. any genuinely distinct development or preview App IDs that issue tokens.
4. Enable manual identity linking so a signed-in Google owner can explicitly
   connect Apple. Never enable a client-side email-based merge.
5. Add `cavalry://auth/callback` as an exact Auth redirect allow-list entry.
   Avoid a broad custom-scheme wildcard.
6. Deploy `delete-cavalry-account`. Set `APPLE_NATIVE_CLIENT_ID` and
   `APPLE_NATIVE_CLIENT_SECRET` as Edge Function secrets, then verify the
   project-provided server admin credential is available. Never copy any of
   these values into a client environment.
7. Verify Realtime exposes only `public.workbooks` for Cavalry metadata
   invalidation. `workbook_versions` and portable snapshot contents must not be
   added to the publication.

## Build-service configuration

- GitHub Actions repository variables for desktop releases:
  `CAVALRY_SUPABASE_URL` and `CAVALRY_SUPABASE_PUBLISHABLE_KEY`.
- EAS project environment variables for each of `development`, `preview`, and
  `production`: `EXPO_PUBLIC_CAVALRY_SUPABASE_URL` and
  `EXPO_PUBLIC_CAVALRY_SUPABASE_PUBLISHABLE_KEY`.
- These are public client identifiers, not authorization secrets. RLS remains
  mandatory. A Supabase secret or service-role key must fail build review even
  if it was accidentally placed in a public-variable slot.
- In the mobile repository, run `npm run cloud:verify-config` for the static app
  and EAS contract. Run `npm run cloud:verify-config:env` to validate the two
  public variables without printing either value. The command automatically
  loads the ignored `.env.local` when present and otherwise uses values supplied
  by the shell or CI environment.
- Confirm the EAS signing profile synced the Sign in with Apple capability for
  the permanent iOS App ID. Do not rely on a Simulator result for Apple
  credential-state behavior.

## Cross-app release verification

1. Complete Google sign-in on the packaged Mac build and the TestFlight build;
   confirm both resolve to the same Supabase `user.id` and Cloud library.
2. Complete native Apple sign-in on a physical iPhone or iPad and Apple browser
   OAuth on Mac; confirm both resolve to the same Supabase `user.id`.
3. Starting from the Google-backed owner, explicitly connect Apple and verify
   the owner ID does not change. Repeat with Hide My Email enabled.
4. Exercise iOS first-boot reconciliation against an empty Cloud library, one
   existing Cloud workbook, and multiple existing Cloud workbooks. Confirm the
   empty library can receive the initial local workbook, the sole remote is
   adopted, and multiple remotes do not receive the pristine blank workbook
   until the user edits or chooses a workbook.
5. Verify local-first automatic sync separately on each client. On iOS, an
   offline edit must persist to SQLite and remain sync-pending across relaunch,
   then sync after reconnect or foreground. On Mac, signing in alone must not
   upload or replace the open workbook, while a subsequent successful local save
   enters the debounced automatic-sync queue.
6. Starting from an acknowledged revision, advance Cloud while the current
   workbook is clean. Confirm Realtime only signals invalidation, the client
   downloads through the owner-scoped RPC, validates the complete snapshot, and
   persists it locally before advancing its revision anchor.
7. Repeat while local work is dirty or queued. Confirm both clients latch a
   conflict and never retry automatically with the newer Cloud revision. On iOS,
   verify **Use Cloud** persists the downloaded snapshot and **Keep Local** saves
   against a freshly listed compare-and-swap revision. On Mac, verify the user
   must first make the local file safe and then explicitly open the Cloud copy.
   None of these paths may claim or perform a field-level merge.
8. With two unrelated real test users, verify neither can select workbook
   metadata, download a snapshot, save against, or subscribe to the other's
   workbook row. Change workbook metadata with user A and confirm user A can
   receive the Realtime event while user B receives nothing.
9. Exercise cancelled, expired, duplicate-parameter, wrong-callback, and
   token-bearing OAuth callbacks. No rejected callback may reach a code exchange
   or expose credentials to UI code.
10. Revoke Apple access and verify launch and foreground checks clear only the
    matching device session. Then test confirmed account deletion and verify Auth,
    database rows, and private feedback objects are removed.

Record the Supabase project, build identifiers, provider-secret expiry dates,
test accounts, test date, and outcomes in the private release record. Do not put
credential values in that record.

Official references:

- [Supabase native mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Expo SDK 57 AppleAuthentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/)
- [Expo EAS environments](https://docs.expo.dev/eas/environment-variables/)
