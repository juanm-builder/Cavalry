-- Fix first-save uploads after PL/pgSQL resolved the RETURNS TABLE output name
-- local_workbook_id ambiguously inside an ON CONFLICT column list.

begin;

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

revoke execute on function public.save_workbook_snapshot(
  text, text, integer, text, integer, text, bigint, uuid, timestamptz
) from public, anon;

grant execute on function public.save_workbook_snapshot(
  text, text, integer, text, integer, text, bigint, uuid, timestamptz
) to authenticated, service_role;

commit;
