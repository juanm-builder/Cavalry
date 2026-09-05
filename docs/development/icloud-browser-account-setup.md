# Browser-selected iCloud account setup

This integration is under development. The account screen and automated transport
tests do not establish that Apple authentication or two-device syncing works in a
signed release. Do not publish this feature until the live acceptance checks below
pass. It preserves the existing Production container and workbook schema.

## One Apple configuration step

The accessible signing credentials cannot create or retrieve CloudKit web API
tokens. An owner of the Apple developer team must configure the web token in
[CloudKit Console](https://icloud.developer.apple.com/).

1. Select `iCloud.com.juanmbuilder.cavalry` and **Production**.
2. Open **Tokens & Keys**, then create or inspect an **API Token** for browser
   access. This is the public token distributed with a client app, not an Apple
   password, signing key, server-to-server private key, or App Store API key.
3. The desktop sign-in page uses the loopback origin
   `http://127.0.0.1:47639`. Configure this exact allowed origin if the Console
   supports it. Keep the custom sign-in callback unset: the integration uses
   Apple's default popup-to-opener response. Do not configure a Supabase callback.
4. If Apple's Console rejects the loopback origin, stop this configuration attempt.
   A supported hosted callback/ephemeral native authentication design must be
   validated instead; do not weaken the app's origin checks or enable all origins
   merely to make the test pass.
5. For a local build, save the public token as `apiToken` in
   `~/Library/Application Support/Cavalry for Mac/CloudKit Web/config.json`.
   The JSON shape is `{"apiToken":"THE_PRODUCTION_CLOUDKIT_API_TOKEN"}`.
   A release build can embed the same public token using
   `CAVALRY_CLOUDKIT_WEB_API_TOKEN` during its host build.

The browser option remains disabled when no validly shaped token is configured.
Its presence enables an authentication attempt, not a claim of successful live
certification. An invalid token or failed sign-in leaves the existing account
selected. Local workbooks remain usable without this configuration.

## Account boundaries

Each browser API operation is serialized for the complete workbook operation,
including lookup, asset upload and record commit. Session tokens are rotated from
Apple's response headers and saved using the existing Keychain-backed encryption
before another request can use them. Tokens never pass through the workbook
renderer, callback query strings, or app logs.

The browser receives Apple's sign-in in a separate window. The local page accepts
messages only from that exact popup and known Apple origins, then posts the token
to a single-use loopback path. Cancellation and timeouts keep the previous
connection. Live testing must confirm Apple's default callback works with this
origin and permits choosing a different Apple Account even with existing cookies.

All workbook requests bind to the full verified CloudKit owner, container and
environment. Pausing retains that connection; signing out clears its active
credentials. Neither operation deletes local workbooks. Pending writes remain
under their original owner when another account is selected. A local workbook
does not become eligible for another owner's autosave simply because they signed
in. Explicitly adding a copy to the selected library is a separate action.

## Native regression checks

From this repository's root on macOS with Xcode selected, run:

```sh
npm run test:cloudkit:native --workspace @cavalry/desktop
```

This compiles the Mac production Swift store for real-filesystem durability and
owner-isolation checks, then tests its production account-event method bodies
against deterministic CloudKit queue doubles. Both harnesses use temporary files
and require no Apple account, cloud configuration, or sibling iOS checkout. These
checks do not replace the live acceptance checks below.

## Required live acceptance before release

- Mac system Apple Account A; iPhone system account B; choose B in Cavalry's Mac
  browser. Both apps must report B's actual CloudKit reference and same library.
- Create a synthetic workbook on each device and edit in both directions. Verify
  the downloaded workbook bytes and meaningful content after confirmation.
- Quit, reopen, update, go offline, expire the browser session and reconnect.
  Local edits must survive; delayed uploads must still belong to B.
- Cancel account selection and attempt invalid/late/cross-origin callbacks. The
  selected account and local workbook must remain unchanged.
- Switch B to C with pending B edits, then return to B. No B content may upload to
  C automatically. Verify the same behavior for a system iCloud account change.
- Exercise encrypted metadata, custom zones, revision conflicts, deletion and
  interrupted asset uploads against the current native implementation.
- Verify the existing 25 MiB asset boundary. Apple's archived asset-upload prose
  and published limit table disagree; a mocked transport test is insufficient.
- Inspect surviving former Cavalry Cloud data through a separately authenticated,
  read-only recovery process. This CloudKit transport does not retrieve Supabase
  workbooks. Preserve originals before importing a selected recovery copy.

## Apple references

- [CloudKit JS and private database access](https://developer.apple.com/documentation/cloudkitjs)
- [Web authentication and token setup](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html)
- [Encrypted fields](https://developer.apple.com/documentation/cloudkit/encrypting-user-data)
- [Data size limits](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/PropertyMetrics.html)
