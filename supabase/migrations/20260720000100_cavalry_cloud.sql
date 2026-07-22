-- Cavalry Cloud: authenticated multi-workbook storage with append-only history.
--
-- The desktop client may use only the Supabase publishable/anon key. Every
-- exposed table is protected by RLS, while snapshot writes go through the
-- optimistic-concurrency RPC at the end of this migration.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) <= 80),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048)
);

create table public.devices (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  installation_id text not null,
  display_name text not null,
  platform text not null,
  app_version text not null default '',
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_owner_installation_unique unique (owner_id, installation_id),
  constraint devices_installation_id_format
    check (
      installation_id = btrim(installation_id)
      and char_length(installation_id) between 1 and 200
    ),
  constraint devices_display_name_length
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint devices_platform_length
    check (char_length(btrim(platform)) between 1 and 40),
  constraint devices_app_version_length
    check (char_length(app_version) <= 80),
  constraint devices_revocation_order
    check (revoked_at is null or revoked_at >= created_at)
);

create table public.workbooks (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  local_workbook_id text not null,
  name text not null,
  year integer not null,
  currency text not null,
  schema_version integer not null,
  latest_revision bigint not null default 0,
  latest_content_hash text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workbooks_owner_workbook_unique unique (owner_id, local_workbook_id),
  constraint workbooks_id_owner_unique unique (id, owner_id),
  constraint workbooks_workbook_id_format
    check (
      local_workbook_id = btrim(local_workbook_id)
      and char_length(local_workbook_id) between 1 and 128
      and local_workbook_id ~ '^[A-Za-z0-9._:-]+$'
    ),
  constraint workbooks_name_length check (char_length(btrim(name)) between 1 and 160),
  constraint workbooks_year_range check (year between 1900 and 9999),
  constraint workbooks_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint workbooks_schema_version_positive check (schema_version > 0),
  constraint workbooks_latest_revision_nonnegative check (latest_revision >= 0),
  constraint workbooks_content_hash_format
    check (latest_content_hash is null or latest_content_hash ~ '^[0-9a-f]{64}$'),
  constraint workbooks_deletion_order check (deleted_at is null or deleted_at >= created_at)
);

create table public.workbook_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workbook_record_id uuid not null,
  owner_id uuid not null,
  revision bigint not null,
  schema_version integer not null,
  content_hash text not null,
  portable_html text not null,
  source_updated_at timestamptz,
  saved_by_device_id uuid references public.devices (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint workbook_versions_workbook_owner_fk
    foreign key (workbook_record_id, owner_id)
    references public.workbooks (id, owner_id)
    on delete cascade,
  constraint workbook_versions_number_unique unique (workbook_record_id, revision),
  constraint workbook_versions_revision_positive check (revision > 0),
  constraint workbook_versions_schema_version_positive check (schema_version > 0),
  constraint workbook_versions_content_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint workbook_versions_portable_html_length
    check (octet_length(portable_html) between 1 and 26214400)
);

create table public.sync_audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null,
  workbook_record_id uuid not null,
  device_id uuid references public.devices (id) on delete set null,
  event_type text not null,
  workbook_revision bigint,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sync_audit_events_workbook_owner_fk
    foreign key (workbook_record_id, owner_id)
    references public.workbooks (id, owner_id)
    on delete cascade,
  constraint sync_audit_events_type_length
    check (char_length(btrim(event_type)) between 1 and 80),
  constraint sync_audit_events_revision_positive
    check (workbook_revision is null or workbook_revision > 0),
  constraint sync_audit_events_details_object check (jsonb_typeof(details) = 'object')
);

create index devices_owner_last_seen_idx
  on public.devices (owner_id, last_seen_at desc);
create index workbooks_owner_updated_idx
  on public.workbooks (owner_id, updated_at desc)
  where deleted_at is null;
create index workbook_versions_owner_created_idx
  on public.workbook_versions (owner_id, created_at desc);
create index workbook_versions_workbook_revision_idx
  on public.workbook_versions (workbook_record_id, revision desc);
create index sync_audit_events_owner_created_idx
  on public.sync_audit_events (owner_id, created_at desc);
create index sync_audit_events_workbook_created_idx
  on public.sync_audit_events (workbook_record_id, created_at desc);

create or replace function public.set_cavalry_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.set_cavalry_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_cavalry_updated_at();

create trigger devices_set_updated_at
before update on public.devices
for each row execute function public.set_cavalry_updated_at();

create or replace function public.handle_cavalry_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    nullif(
      left(
        btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')),
        80
      ),
      ''
    ),
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), 2048), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_cavalry_auth_user_created()
  from public, anon, authenticated;

drop trigger if exists on_cavalry_auth_user_created on auth.users;
create trigger on_cavalry_auth_user_created
after insert on auth.users
for each row execute function public.handle_cavalry_auth_user_created();

-- The trigger only sees future signups, so create profiles for users that
-- existed before this migration was applied.
insert into public.profiles (user_id, display_name, avatar_url)
select
  users.id,
  nullif(
    left(
      btrim(coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', '')),
      80
    ),
    ''
  ),
  nullif(left(btrim(coalesce(users.raw_user_meta_data ->> 'avatar_url', '')), 2048), '')
from auth.users as users
on conflict (user_id) do nothing;

-- Versions and audit entries are append-only for application roles. Database
-- administrators may still delete history as part of an authorized account
-- deletion/retention operation, but even service-role updates are rejected.
create or replace function public.reject_cavalry_history_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'cavalry_history_is_append_only';
end;
$$;

revoke execute on function public.reject_cavalry_history_update()
  from public, anon, authenticated;

create trigger workbook_versions_reject_update
before update on public.workbook_versions
for each row execute function public.reject_cavalry_history_update();

create trigger sync_audit_events_reject_update
before update on public.sync_audit_events
for each row execute function public.reject_cavalry_history_update();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.devices enable row level security;
alter table public.devices force row level security;
alter table public.workbooks enable row level security;
alter table public.workbooks force row level security;
alter table public.workbook_versions enable row level security;
alter table public.workbook_versions force row level security;
alter table public.sync_audit_events enable row level security;
alter table public.sync_audit_events force row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy profiles_delete_own
on public.profiles for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy devices_select_own
on public.devices for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy devices_insert_own
on public.devices for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy devices_update_own
on public.devices for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy workbooks_select_own
on public.workbooks for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy workbook_versions_select_own
on public.workbook_versions for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy sync_audit_events_select_own
on public.sync_audit_events for select
to authenticated
using ((select auth.uid()) = owner_id);

-- Start from no Data API access, then grant only the operations the desktop
-- application needs. Workbook, version, and audit writes remain RPC-only.
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.devices from public, anon, authenticated;
revoke all on table public.workbooks from public, anon, authenticated;
revoke all on table public.workbook_versions from public, anon, authenticated;
revoke all on table public.sync_audit_events from public, anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update on table public.devices to authenticated;
grant select on table public.workbooks to authenticated;
grant select on table public.workbook_versions to authenticated;
grant select on table public.sync_audit_events to authenticated;

grant all on table public.profiles to service_role;
grant all on table public.devices to service_role;
grant all on table public.workbooks to service_role;
grant all on table public.workbook_versions to service_role;
grant all on table public.sync_audit_events to service_role;

create or replace function public.save_workbook_snapshot(
  p_local_workbook_id text,
  p_name text,
  p_year integer,
  p_currency text,
  p_schema_version integer,
  p_portable_html text,
  p_expected_revision bigint default null,
  p_device_id uuid default null,
  p_source_updated_at timestamptz default null
)
returns table (
  local_workbook_id text,
  name text,
  year integer,
  currency text,
  latest_revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_workbook public.workbooks%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_next_revision bigint;
  v_content_hash text;
  v_saved_at timestamptz := clock_timestamp();
  v_event_type text;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_local_workbook_id is null
     or p_local_workbook_id <> btrim(p_local_workbook_id)
     or char_length(p_local_workbook_id) not between 1 and 128
     or p_local_workbook_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'invalid_local_workbook_id';
  end if;

  if p_expected_revision is not null and p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'invalid_expected_revision';
  end if;

  if char_length(v_name) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'invalid_workbook_name';
  end if;

  if p_year is null or p_year not between 1900 and 9999 then
    raise exception using errcode = '22023', message = 'invalid_workbook_year';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'invalid_workbook_currency';
  end if;

  if p_schema_version is null or p_schema_version <= 0 then
    raise exception using errcode = '22023', message = 'invalid_schema_version';
  end if;

  if p_portable_html is null or octet_length(p_portable_html) = 0 then
    raise exception using errcode = '22023', message = 'invalid_workbook_snapshot';
  end if;

  if octet_length(p_portable_html) > 26214400 then
    raise exception using errcode = '54000', message = 'workbook_snapshot_too_large';
  end if;

  -- Public-key clients can invoke this RPC directly, so owner quotas must be
  -- enforced in Postgres rather than trusted to the desktop UI. The advisory
  -- transaction lock serializes quota checks across different workbooks for
  -- the same owner.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text, 20260720)
  );

  if not exists (
    select 1
    from public.workbooks as workbook
    where workbook.owner_id = v_owner_id
      and workbook.local_workbook_id = p_local_workbook_id
  ) and (
    select count(*)
    from public.workbooks as workbook
    where workbook.owner_id = v_owner_id
  ) >= 50 then
    raise exception using errcode = '54000', message = 'owner_workbook_quota_exceeded';
  end if;

  if (
    select count(*)
    from public.workbook_versions as snapshot
    where snapshot.owner_id = v_owner_id
  ) >= 1000 then
    raise exception using errcode = '54000', message = 'owner_version_quota_exceeded';
  end if;

  if coalesce((
    select sum(octet_length(snapshot.portable_html))
    from public.workbook_versions as snapshot
    where snapshot.owner_id = v_owner_id
  ), 0) + octet_length(p_portable_html) > 524288000 then
    raise exception using errcode = '54000', message = 'owner_storage_quota_exceeded';
  end if;

  if p_device_id is not null and not exists (
    select 1
    from public.devices as device
    where device.id = p_device_id
      and device.owner_id = v_owner_id
      and device.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'device_not_trusted';
  end if;

  -- A placeholder at revision zero makes concurrent first saves serialize on
  -- the same unique owner/workbook row. The transaction rolls it back if any
  -- subsequent validation or revision check fails.
  insert into public.workbooks (
    owner_id,
    local_workbook_id,
    name,
    year,
    currency,
    schema_version,
    latest_revision,
    source_updated_at,
    created_at,
    updated_at
  ) values (
    v_owner_id,
    p_local_workbook_id,
    v_name,
    p_year,
    v_currency,
    p_schema_version,
    0,
    p_source_updated_at,
    v_saved_at,
    v_saved_at
  )
  on conflict on constraint workbooks_owner_workbook_unique do nothing;

  select workbook.*
  into v_workbook
  from public.workbooks as workbook
  where workbook.owner_id = v_owner_id
    and workbook.local_workbook_id = p_local_workbook_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workbook_access_denied';
  end if;

  if v_workbook.deleted_at is not null then
    raise exception using errcode = '55000', message = 'workbook_is_deleted';
  end if;

  if (v_workbook.latest_revision = 0 and p_expected_revision is not null)
     or (v_workbook.latest_revision > 0 and p_expected_revision is distinct from v_workbook.latest_revision) then
    raise exception using
      errcode = '40001',
      message = 'workbook_revision_conflict',
      detail = format(
        'Expected revision %s but latest revision is %s.',
        coalesce(p_expected_revision::text, 'none'),
        v_workbook.latest_revision
      ),
      hint = 'Download the latest snapshot and resolve the conflict before saving again.';
  end if;

  if v_workbook.latest_revision >= 200 then
    raise exception using errcode = '54000', message = 'workbook_version_quota_exceeded';
  end if;

  v_next_revision := v_workbook.latest_revision + 1;
  v_content_hash := encode(
    extensions.digest(convert_to(p_portable_html, 'UTF8'), 'sha256'),
    'hex'
  );
  v_event_type := case
    when v_workbook.latest_revision = 0 then 'workbook.created'
    else 'workbook.snapshot_saved'
  end;

  insert into public.workbook_versions (
    workbook_record_id,
    owner_id,
    revision,
    schema_version,
    content_hash,
    portable_html,
    source_updated_at,
    saved_by_device_id,
    created_at
  ) values (
    v_workbook.id,
    v_owner_id,
    v_next_revision,
    p_schema_version,
    v_content_hash,
    p_portable_html,
    p_source_updated_at,
    p_device_id,
    v_saved_at
  );

  update public.workbooks as workbook
  set name = v_name,
      year = p_year,
      currency = v_currency,
      schema_version = p_schema_version,
      latest_revision = v_next_revision,
      latest_content_hash = v_content_hash,
      source_updated_at = p_source_updated_at,
      updated_at = v_saved_at
  where workbook.id = v_workbook.id
    and workbook.owner_id = v_owner_id;

  insert into public.sync_audit_events (
    owner_id,
    workbook_record_id,
    device_id,
    event_type,
    workbook_revision,
    details,
    created_at
  ) values (
    v_owner_id,
    v_workbook.id,
    p_device_id,
    v_event_type,
    v_next_revision,
    jsonb_build_object(
      'previous_revision', v_workbook.latest_revision,
      'content_hash', v_content_hash,
      'source_updated_at', p_source_updated_at
    ),
    v_saved_at
  );

  return query
  select
    p_local_workbook_id,
    v_name,
    p_year,
    v_currency,
    v_next_revision,
    v_saved_at;
end;
$$;

create or replace function public.download_workbook_snapshot(
  p_local_workbook_id text
)
returns table (
  local_workbook_id text,
  name text,
  year integer,
  currency text,
  latest_revision bigint,
  updated_at timestamptz,
  portable_html text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  return query
  select
    workbook.local_workbook_id,
    workbook.name,
    workbook.year,
    workbook.currency,
    workbook.latest_revision,
    workbook.updated_at,
    snapshot.portable_html
  from public.workbooks as workbook
  join public.workbook_versions as snapshot
    on snapshot.workbook_record_id = workbook.id
   and snapshot.owner_id = workbook.owner_id
   and snapshot.revision = workbook.latest_revision
  where workbook.owner_id = v_owner_id
    and workbook.local_workbook_id = p_local_workbook_id
    and workbook.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'workbook_not_found';
  end if;
end;
$$;

create or replace function public.delete_workbook(
  p_local_workbook_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_deleted_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- This is an explicit privacy deletion. Cascades remove every version and
  -- audit row for the workbook; ordinary authenticated table access remains
  -- append-only and cannot perform this deletion directly.
  delete from public.workbooks as workbook
  where workbook.owner_id = v_owner_id
    and workbook.local_workbook_id = p_local_workbook_id
  returning workbook.id into v_deleted_id;

  return v_deleted_id is not null;
end;
$$;

revoke execute on function public.save_workbook_snapshot(
  text, text, integer, text, integer, text, bigint, uuid, timestamptz
) from public, anon;
revoke execute on function public.download_workbook_snapshot(text) from public, anon;
revoke execute on function public.delete_workbook(text) from public, anon;

grant execute on function public.save_workbook_snapshot(
  text, text, integer, text, integer, text, bigint, uuid, timestamptz
) to authenticated, service_role;
grant execute on function public.download_workbook_snapshot(text)
  to authenticated, service_role;
grant execute on function public.delete_workbook(text)
  to authenticated, service_role;

commit;
