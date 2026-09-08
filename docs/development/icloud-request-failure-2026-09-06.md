# Browser iCloud save rejection — 2026-09-06

## Report and reproduction

The user confirmed that browser account selection now opens the same account and library on
their Mac and iPhone. On Mac 2.2.10, saving still produced `cloudkit_request_failed`, and the
workbook card could show **Synced** beside the failure banner.

An isolated test used the immutable 2.2.10 browser transport against the Production CloudKit
container. The user completed Apple sign-in for the test. Only newly generated, disposable
workbook IDs were looked up or changed; existing workbook records were not listed or opened.
The browser session remained in memory and was discarded after testing.

| Controlled request                                          | Apple response                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Original 2.2.10 save                                        | Asset upload succeeds; `records/modify` returns HTTP 400, `BAD_REQUEST`, `Unexpected input` |
| Explicit encrypted string/integer types, original asset tag | Same HTTP 400 rejection                                                                     |
| Correct asset tag, original untyped encrypted fields        | Per-record `BAD_REQUEST`: `byte values must be base64 encoded`                              |
| Correct asset tag and explicit encrypted field types        | Create, guarded update, download, conflict publish/download/clear, and cleanup succeed      |

The final test downloaded the same workbook bytes that it uploaded. Both populated conflict
payloads also matched their source bytes. Each disposable record was removed through its exact
record name and current change tag; no account, zone, or existing workbook was deleted.

## Correction

`cloudkit-web-records.cjs` now encodes asset references with the accepted Web Services tag
`ASSETID`. The previous `ASSET` tag described a conceptual type but was rejected in the request.
Encrypted metadata explicitly declares `STRING` or `INT64`, including nullable fields. Conflict
clearing patches the twelve conflict fields to typed null values while preserving the workbook
payload and revision.

Apple's generic [field dictionary](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/Types.html)
describes `type` as optional. The live tests above establish why omitting the logical type did not
work for Cavalry's existing encrypted fields. Apple's [encrypted-field example](https://developer.apple.com/documentation/cloudkit/encrypting-user-data)
uses explicit logical types together with `isEncrypted`. The raw file upload remains consistent
with the [asset upload contract](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/UploadAssets.html).

No CloudKit schema migration, workbook format change, force update, queue deletion, or account
change is required. Existing owner-scoped queued saves use the corrected encoder when retried.
The iPhone uses native CloudKit and does not construct these rejected web requests, so this fix
does not require an iPhone code change or another TestFlight build.

## Failure reporting and verification

The browser API and library distinguish rejected requests from transient service failures.
Details contain only allowlisted Apple codes, operation names, HTTP status, and bounded retry
delay. Raw reasons, URLs, response bodies, credentials, and workbook contents are excluded.
Network and interrupted asset transfers remain retryable; permanent rejection stops the current
renderer autosave retry schedule. The host retains unsent work in its verified owner's durable
outbox and attempts it again during later syncs, including background library refreshes.

The workbook card shows **Needs attention** after a failed current-workbook save and **Waiting**
for local edits. An unrelated successful listing does not acknowledge a failed upload or clear
its error. Confirmed cloud timestamps remain visible.

Successful browser saves retain a small, encrypted acknowledgment tied to the exact outbox
operation, workbook, and owner before retiring the queued operation. A restart can finish that
local acknowledgment without submitting the same save again. The renderer verifies the saved
revision before repairing its merge base; edits made since the upload remain local changes.

Regression tests use independent typed record/asset fixtures rather than constructing a fake
server response by echoing the client request. They cover the accepted encodings, conflict
clearing, nested rejection diagnostics, transient transfers, scoped status, and retry behavior.
The draft release records full source checks and signed packaged verification separately.

The controlled test proves this request correction. Verification on the originally affected
devices remains a release acceptance check; the test did not inspect or recover the customer's
original workbook.
