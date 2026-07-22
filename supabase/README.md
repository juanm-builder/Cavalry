# Cavalry Cloud database

This directory contains the Supabase database contract for Cavalry Cloud. The
first migration creates an authenticated, multi-workbook store with immutable
version snapshots, append-only audit history, device records, and owner-only Row
Level Security (RLS).

## What the migration provides

- `profiles`: one private profile for each Supabase Auth user. A signup trigger
  copies the Google display name and avatar metadata, and the migration backfills
  users that already exist.
- `devices`: installations owned by a user. Set `revoked_at` instead of deleting a
  device that has saved workbook history.
- `workbooks`: lightweight library metadata for every workbook a user uploads.
- `workbook_versions`: complete portable HTML snapshots. Authenticated clients can read
  their own history but cannot insert, update, or delete it directly.
- `sync_audit_events`: append-only metadata describing each accepted save. It
  intentionally does not duplicate workbook contents.
- `save_workbook_snapshot(...)`: the only authenticated write path for workbook
  snapshots. It locks the workbook row and compares `p_expected_revision` before
  appending the next revision.

The first upload omits `p_expected_revision` (or sends `null`). Every later upload
must pass the `latest_revision` most recently read by the client. A stale save
fails with SQL state `40001` and message `workbook_revision_conflict`; the caller
must fetch the new revision and present a conflict-resolution flow. It must never
retry with the new revision automatically, because that would silently overwrite
financial data.

## Apply it to the existing Supabase project

The repository already contains the `supabase/config.toml` created by `supabase
init`. Install the Supabase CLI, authenticate, and link this checkout to the
project:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Keep the GitHub Supabase integration rooted at the repository root so it finds
`supabase/config.toml` and `supabase/migrations/`. Review production deployment
settings in Supabase before enabling automatic migration deployment from the
default branch.

The project reference is an identifier, not a database password. Do not commit
the database password, access or refresh tokens, OAuth secrets, the legacy
`service_role` key, or a Supabase secret key. Local environment files are already
ignored by the repository.

In the Supabase Dashboard:

1. Enable the Google provider under Authentication > Providers.
2. Configure Google's client ID and secret in Supabase, not in the desktop app.
3. Add the exact Cavalry desktop callback URL, `cavalry://auth/callback`, to
   Supabase's redirect allow list.
4. Add the Supabase callback URL shown by the Dashboard to the Google OAuth
   client's authorized redirect URIs.
5. Keep email confirmation and account-lifecycle settings aligned with the
   product's support and deletion policy.

The desktop app needs only the project URL and Supabase publishable key (or the
legacy `anon` key). Those identify the project but do not bypass RLS. Never ship a
secret key or `service_role` key in Electron, preload, or renderer code.

## Desktop query contract

List non-deleted workbook metadata without downloading financial snapshots:

```js
const { data, error } = await supabase
  .from('workbooks')
  .select('local_workbook_id,name,year,currency,latest_revision,updated_at')
  .is('deleted_at', null)
  .order('updated_at', { ascending: false });
```

Save a full, validated workbook snapshot with optimistic concurrency:

```js
const { data, error } = await supabase.rpc('save_workbook_snapshot', {
  p_local_workbook_id: workbook.id,
  p_name: workbook.name,
  p_year: workbook.year,
  p_currency: workbook.currency,
  p_schema_version: workbook.version,
  p_portable_html: serializedWorkbook.html,
  p_expected_revision: cloudRevision,
  p_device_id: deviceId,
  p_source_updated_at: workbook.updatedAt || null
});
```

Download the latest owner-authorized snapshot through
`download_workbook_snapshot({ p_local_workbook_id })`. Validate and normalize its
`portable_html` with Cavalry's workbook persistence service before replacing the
local workbook. `delete_workbook({ p_local_workbook_id })` performs an explicit
privacy deletion and cascades all versions and audit rows for that workbook.

## Security and operations

- RLS is enabled and forced on every exposed table. Policies always compare the
  authenticated `auth.uid()` with the row owner.
- The save RPC is `security definer` so it can own the append transaction; it uses
  an empty `search_path`, fully qualified relations, explicit authentication and
  ownership checks, an owner quota lock, and a conditional trusted-device check
  when a client supplies an enrolled `p_device_id`. The desktop MVP does not yet
  enroll devices.
- Portable HTML hashes are computed in Postgres with SHA-256 rather than trusted
  from the client. Snapshots larger than 25 MiB are rejected.
- Database-enforced closed-beta quotas allow at most 50 workbooks, 200 versions
  per workbook, 1,000 versions total, and 500 MiB of snapshots per owner. These
  limits apply even when an authenticated user calls the public RPC directly.
- Authenticated roles have read-only access to workbooks, versions, and audit
  events. History updates are also rejected by triggers.
- Administrative deletion remains possible for lawful account deletion and data
  retention. Delete Cavalry rows before deleting an Auth user if an operational
  workflow adds additional restrictive references later.
- Supabase backups are not a user-facing version restore feature. Recovery UI
  should use `workbook_versions`, and restoring an old snapshot should append a
  new version through the same concurrency RPC.

Before production, run the migration against a disposable Supabase branch and
verify with two real test users that neither can list, read, mutate, or invoke a
save against the other's workbook.
