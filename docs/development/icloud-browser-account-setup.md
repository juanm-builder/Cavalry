# Browser-selected iCloud account setup

This integration is under development. The account screen and automated transport
tests do not establish that Apple authentication or two-device syncing works in a
signed release. Do not publish this feature until the live acceptance checks below
pass. It preserves the existing Production container and workbook schema.

## HTTPS sign-in hosting and Apple configuration

The browser flow uses the static page in `apps/desktop/cloudkit-sign-in/`, served
at `https://juanm-builder.github.io/Cavalry/icloud-sign-in/`. Publish the page
before enabling the token. The entire `https://juanm-builder.github.io` origin
is trusted: other project pages and root service workers on that origin share
this boundary. A dedicated auth domain should be used if that origin hosts
untrusted applications. The page has no analytics, cookies, network requests,
server-side credential handling, or persistent token storage.

Use [CloudKit Console](https://icloud.developer.apple.com/) with the developer team:

1. Select `iCloud.com.juanmbuilder.cavalry` and **Production**.
2. Open **Tokens & Keys**, then create an **API Token** for browser access. This is
   a public client token, not an Apple password, signing key, server-to-server
   private key, or App Store API key.
3. Keep **Sign in Callback → Post Message** selected. Do not configure a custom
   redirect or Supabase callback.
4. Set **Allowed Origins → Only the following domain(s)**. The Console adds the
   `https://` prefix; enter `juanm-builder.github.io` in its domain field. Do not
   enable **Any Domain**. Keep discoverability off.
5. Verify a `Production/private/users/current` request with this token and
   `Origin: https://juanm-builder.github.io` returns `AUTHENTICATION_REQUIRED`
   and an approved Apple sign-in URL. This unauthenticated request accesses no
   workbook records. Token presence alone does not establish successful login.
6. After live callback validation, save `{"apiToken":"PUBLIC_API_TOKEN"}` to
   `~/Library/Application Support/Cavalry for Mac/CloudKit Web/config.json` and
   fully quit/relaunch the feature build. A release host build can embed the token
   using `CAVALRY_CLOUDKIT_WEB_API_TOKEN`; a nonempty embedded token takes precedence
   over local configuration.
7. Set the same validated public token as the GitHub Actions **repository variable**
   `CAVALRY_CLOUDKIT_WEB_API_TOKEN` before creating a release tag. The release
   workflow passes it to the host and sidecar builds for both Mac architectures
   and fails before those builds if it is missing or not 64 hexadecimal characters.
   Keep the actual value out of tracked source. This shape check does not validate
   Apple's configuration or replace the live acceptance checks below. The signed
   sidecar smoke also requires browser sign-in to be available with empty runtime
   configuration and a fresh temporary data directory, verifying the token was
   embedded in the packaged host without authenticating to Apple.

### Why the HTTPS page is required

A live Console/API check on 2026-09-05 confirmed that a newly created restricted
Production token accepted `https://127.0.0.1:47639`, returning Apple's sign-in URL,
but rejected `http://127.0.0.1:47639` with `AUTHENTICATION_FAILED`. The old local
HTTP page therefore cannot be Apple's direct popup receiver. The HTTPS page
receives that callback and relays it only to its exact loopback opener. The
loopback server still accepts completion only through its own origin and random
single-use path; it does not accept a cross-origin HTTP POST from the hosted page.

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

The local page opens the fixed HTTPS bridge with a random nonce in its fragment.
The bridge removes that fragment immediately and uses a nonce-bound handshake
with the exact local opener before enabling its Apple sign-in button. It accepts
Apple's result only from the exact Apple popup and approved Apple HTTPS origins.
Those callback origins include `https://cdn.apple-cloudkit.com`: the live Firefox
diagnostic on 2026-09-06 received a valid-shaped `ckSession` from that exact origin
and expected popup. This callback permission does not allow starting sign-in at
the CDN or at other Apple subdomains.
It relays the token in memory through `postMessage`; the local page checks the
HTTPS origin, popup source, nonce and protocol state, then uses a same-origin
POST. Cancellation, expiry and duplicate callbacks cannot complete another
attempt. The hosted page must leave COOP unset/default so its cross-origin opener
survives; it rejects framed/no-opener contexts before enabling sign-in. Its meta
CSP is not a substitute for a `frame-ancestors` response header.

Live testing must verify both popup relationships in Firefox and confirm users
can choose a different Apple Account despite existing browser cookies.

For a failing live callback, the local validation harness can opt in with
`authenticateInBrowser({ ..., diagnostics: true })`. This enables a metadata-only
report on the local page that survives a cancelled attempt. It records callback
origin, expected-popup match, payload type, and token/error field presence or
validity; it never records credential values, error text or account identity.
Diagnostics are off by default and do not change callback acceptance rules.
Completing Apple's login form alone is insufficient: `users/current` must verify
the returned session before marking browser authentication as working.

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
