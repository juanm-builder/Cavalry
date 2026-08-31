# iCloud workbook sync

Cavalry is local-first on both iPhone and Mac. Each app keeps its own usable local copy; a private CloudKit database carries validated workbook snapshots between devices when connectivity is available. The HTML workbook remains the portable import/export format, not the live shared database.

## Shared Apple identity

- iPhone bundle identifier: `com.juanmbuilder.cavalry.ios`
- Mac bundle identifier: `com.juanmbuilder.cavalry.mac`
- Private CloudKit container: `iCloud.com.juanmbuilder.cavalry`
- Minimum operating systems: iOS 17 and macOS 14

There is no Cavalry account or browser sign-in. Cloud availability follows the Apple Account signed in on the device. Switching Apple Accounts clears only Cavalry's local CloudKit cache and change tokens; local workbooks remain on the device.

## Data path

```text
iPhone local database ⇄ private CloudKit database ⇄ Mac local workbook/cache
```

A local save completes before CloudKit work begins. The native sync engine then queues a record-level snapshot, saves its change-token state atomically, and lets the operating system schedule efficient fetches and sends. Explicit refresh asks the same engine to fetch and send now; Cavalry does not run a polling timer.

Both apps let `CKSyncEngine` discover or create its database subscription, as Apple recommends for a new sync implementation. Cavalry persists the engine's opaque state separately on every device so each app keeps its own change tokens while sharing the same private database. The migration to system-managed subscriptions resets only that opaque engine state and re-seeds the zone and pending outbox; local workbooks and cached payloads are retained.

Each workbook is one `CavalryWorkbook` record in the private custom zone `CavalryWorkbooksV1`. Its stable record name is derived from a SHA-256 hash of the workbook ID. Name, year, currency, revision, source update time, and payload hash use CloudKit encrypted fields. The HTML is a `CKAsset`, which CloudKit encrypts automatically in the private database. Snapshot payloads are capped at 25 MiB and their SHA-256 hash is verified before use.

## Durable offline behavior

Pending saves and deletes, cached remote metadata, CloudKit system fields, sync-engine serialization, and payload files live in Application Support. A queued save can be edited again offline: Cavalry replaces the pending payload and advances its intended revision without creating redundant uploads. Reconnect uses the saved CKSyncEngine state and sends only pending changes.

Manual **Add to iCloud** uses that same validated save path. Manual **Remove from iCloud** queues an idempotent deletion for the workbook's stable private-record ID and never removes the workbook stored on the device, even when the local CloudKit cache is incomplete. If a previously listed workbook is missing from the cache when the user opens it, Cavalry performs one exact-record lookup before reporting that the iCloud copy no longer exists.

Temporary network, service, authentication, rate-limit, and zone-busy failures remain queued for system-managed retry. Terminal failures are removed from the outbox and surfaced to the UI instead of becoming permanent background work. Sync and send requests are single-flight, native event refreshes are coalesced, and no repeating timers are created.

## Conflict rules

Cavalry uses CloudKit record change tags, a durable workbook revision anchor, and the last server-confirmed workbook as a three-way merge base.

- A queued local save is marked pending; it does not advance the merge base until CloudKit confirms it.
- Two offline devices can both propose the same next numeric revision. The native layer therefore exposes CloudKit's record conflict separately instead of relying on revision numbers alone.
- After a conflict, Cavalry downloads the server winner and combines independent stable-ID changes. Separate transaction additions, one-sided edits, and one-sided deletes are preserved automatically.
- If both devices changed the same transaction or workbook item differently, Cavalry stops for review instead of inventing a financial result.
- The device that retains the unresolved branch creates a compact, human-readable change report. It lists affected transactions or workbook items and the changed fields for each side; it never uploads a second workbook branch or raw workbook JSON for this purpose.
- That report is stored in encrypted fields on the existing workbook record, so the other device also shows the warning and can inspect the differences. Only the device retaining the unresolved branch offers resolution controls; the other device presents the report as read-only.
- Resolving the conflict clears the shared report. Pending report writes and clears use the same durable CKSyncEngine outbox, with one bounded record-change retry and no polling loop.
- A conflicted pending upload is removed from the native outbox so it cannot overwrite the server later.
- The merged result is saved locally first, then sent with one fresh compare-and-swap revision. A second race gets one bounded retry; there is no retry loop.
- Upgrading from an older revision-only anchor first downloads and verifies the actual server snapshot. A conservative transaction union is allowed only when all shared transactions and substantive non-transaction fields agree.
- A server echo whose revision and payload hash match the pending save is recognized as the device's own upload, including after an app restart.

The UI reports `Synced`, `Saving to iCloud`, `Saved locally · sync pending`, and `Needs sync review` rather than treating a local save as a completed network transfer.

## Apple Developer setup

Before a signed build can sync, configure the following in the Apple Developer account:

1. Register App IDs for both bundle identifiers.
2. Create or select `iCloud.com.juanmbuilder.cavalry` and assign the same container to both App IDs.
3. Enable iCloud/CloudKit and Push Notifications for both App IDs.
4. Create development and distribution provisioning profiles that include those capabilities.
5. Build and run each app once in the development environment, then use CloudKit Console to deploy the production schema before distributing production builds.
6. Confirm that the signed Mac app embeds a matching provisioning profile and that its effective entitlements contain the shared container and push environment.

Development builds use the development push and CloudKit environments. The Mac release overlay uses `entitlements.release.plist`, embeds the Developer ID provisioning profile, and requires the production environments. No CloudKit API key, database URL, or user credential belongs in an app environment file.

The Production database must contain the complete `CavalryWorkbook` contract below. The record lives in the private custom zone `CavalryWorkbooksV1`; fields marked encrypted are written through `CKRecord.encryptedValues`. CloudKit automatically encrypts asset contents in the private database.

| Field                      | CloudKit type | Storage                | Required for a normal workbook |
| -------------------------- | ------------- | ---------------------- | ------------------------------ |
| `schemaVersion`            | Int(64)       | Plain record field     | Yes                            |
| `workbookId`               | String        | Encrypted              | Yes                            |
| `name`                     | String        | Encrypted              | Yes                            |
| `year`                     | Int(64)       | Encrypted              | No                             |
| `currency`                 | String        | Encrypted              | Yes                            |
| `revision`                 | Int(64)       | Encrypted              | Yes                            |
| `sourceUpdatedAt`          | String        | Encrypted              | Yes                            |
| `payloadHash`              | String        | Encrypted              | Yes                            |
| `payloadAsset`             | Asset         | Private-database asset | Yes                            |
| `conflictId`               | String        | Encrypted              | No                             |
| `conflictSourceDevice`     | String        | Encrypted              | No                             |
| `conflictDetectedAt`       | String        | Encrypted              | No                             |
| `conflictBaseRevision`     | Int(64)       | Encrypted              | No                             |
| `conflictRemoteRevision`   | Int(64)       | Encrypted              | No                             |
| `conflictSummary`          | String        | Encrypted              | No                             |
| `conflictReport`           | String        | Encrypted              | No                             |
| `conflictPackageNoticeId`  | String        | Encrypted              | No                             |
| `conflictPayloadHash`      | String        | Encrypted              | No                             |
| `conflictPayloadAsset`     | Asset         | Private-database asset | No                             |
| `conflictBasePayloadHash`  | String        | Encrypted              | No                             |
| `conflictBasePayloadAsset` | Asset         | Private-database asset | No                             |

The conflict notice and conflict package fields are optional as a group during ordinary sync. A device writes them only while sharing an unresolved conflict and clears them after resolution. Cavalry fetches changes by zone or stable record ID, so this contract does not require app-defined query or sort indexes.

`cloud_database_update_required` is a terminal, user-safe diagnostic: CloudKit rejected a `CavalryWorkbook` write because the Production record type or one of the fields above is absent or behind Development. The local workbook remains unchanged and safe. Do not treat this code as a connectivity problem or queue automatic retries; deploy the current Development schema to Production, validate it, and then let the user retry explicitly.

### Production schema release gate

Before shipping either app with a new or changed CloudKit field:

1. Exercise creation, update, deletion, and conflict reporting against Development so every intended record type and field is registered.
2. Compare the Development `CavalryWorkbook` record type with the contract above, including all five conflict package fields and their exact types.
3. Deploy the Development schema to Production in CloudKit Console for `iCloud.com.juanmbuilder.cavalry`.
4. Re-open the Production schema and verify the `CavalryWorkbook` record type, the `CavalryWorkbooksV1` custom zone, and every field and type in the table. Do not rely only on the deployment success banner.
5. With release-signed iPhone and Mac builds, create a new workbook record in Production, update it from the other platform, exercise a conflict package, clear the conflict, and delete the iCloud copy while confirming both local copies remain usable.
6. Block distribution if a Production write returns `cloud_database_update_required`, `CKError.serverRejectedRequest`, or a partial failure containing that per-record error.

Tauri signs the Node host sidecar separately from the application. The build's codesign shim gives the app the CloudKit, push, application-identifier, and team entitlements while giving the sidecar only the JIT permissions it needs. Applying the app's CloudKit entitlements to the sidecar causes macOS to terminate it. The architecture and release checks enforce that separation.

## Verification

Repository checks validate the bundle identities, entitlements, native Swift bridges, and absence of non-Apple package targets. Device testing should cover first upload from each device, simultaneous edits, airplane-mode edits followed by reconnect, app termination with a pending change, Apple Account sign-out/switch, record deletion, iCloud quota failure, and a clean install that downloads an existing private library.
