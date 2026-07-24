-- Cavalry Cloud feedback: private owner-scoped reports and optional images.
--
-- The desktop client uses only its authenticated Supabase session. Report and
-- attachment metadata are created through bounded RPCs; image bytes live in a
-- private Storage bucket and are addressable only through matching metadata.

begin;

create table public.feedback_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_request_id uuid not null,
  request_hash text not null,
  kind text not null,
  description text not null,
  source text not null,
  status text not null default 'received',
  context jsonb not null default '{}'::jsonb,
  app_version text not null default '',
  platform text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_reports_id_owner_unique unique (id, owner_id),
  constraint feedback_reports_owner_request_unique unique (owner_id, client_request_id),
  constraint feedback_reports_request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint feedback_reports_kind check (kind in ('bug', 'feedback')),
  constraint feedback_reports_description
    check (
      description = btrim(description)
      and char_length(description) between 1 and 10000
      and octet_length(description) <= 40000
    ),
  constraint feedback_reports_source check (source in ('assistant', 'settings')),
  constraint feedback_reports_status
    check (status in ('received', 'reviewing', 'resolved', 'closed')),
  constraint feedback_reports_context_object check (jsonb_typeof(context) = 'object'),
  constraint feedback_reports_context_size check (octet_length(context::text) <= 4096),
  constraint feedback_reports_app_version_length check (char_length(app_version) <= 80),
  constraint feedback_reports_platform_length check (char_length(platform) <= 40)
);

create table public.feedback_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  report_id uuid not null,
  owner_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint feedback_attachments_report_owner_fk
    foreign key (report_id, owner_id)
    references public.feedback_reports (id, owner_id)
    on delete cascade,
  constraint feedback_attachments_one_per_report unique (report_id),
  constraint feedback_attachments_storage_path_unique unique (storage_path),
  constraint feedback_attachments_storage_path_length
    check (char_length(storage_path) between 1 and 512),
  constraint feedback_attachments_file_name
    check (file_name = btrim(file_name) and char_length(file_name) between 1 and 240),
  constraint feedback_attachments_mime_type
    check (mime_type in ('image/png', 'image/jpeg')),
  constraint feedback_attachments_size check (size_bytes between 1 and 8388608),
  constraint feedback_attachments_upload_order
    check (uploaded_at is null or uploaded_at >= created_at)
);

create index feedback_reports_owner_created_idx
  on public.feedback_reports (owner_id, created_at desc);
create index feedback_attachments_owner_created_idx
  on public.feedback_attachments (owner_id, created_at desc);

create trigger feedback_reports_set_updated_at
before update on public.feedback_reports
for each row execute function public.set_cavalry_updated_at();

alter table public.feedback_reports enable row level security;
alter table public.feedback_reports force row level security;
alter table public.feedback_attachments enable row level security;
alter table public.feedback_attachments force row level security;

create policy feedback_reports_select_own
on public.feedback_reports for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy feedback_attachments_select_own
on public.feedback_attachments for select
to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.feedback_reports from public, anon, authenticated;
revoke all on table public.feedback_attachments from public, anon, authenticated;

grant select on table public.feedback_reports to authenticated;
grant select on table public.feedback_attachments to authenticated;

grant all on table public.feedback_reports to service_role;
grant all on table public.feedback_attachments to service_role;

create or replace function public.create_feedback_report(
  p_expected_owner_id uuid,
  p_client_request_id uuid,
  p_kind text,
  p_description text,
  p_source text,
  p_context jsonb,
  p_app_version text,
  p_platform text,
  p_attachment_file_name text,
  p_attachment_mime_type text,
  p_attachment_size_bytes bigint
)
returns table (
  report_id uuid,
  attachment_id uuid,
  storage_path text,
  created_at timestamptz,
  attachment_uploaded_at timestamptz,
  request_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_report_id uuid;
  v_attachment_id uuid;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_description text := btrim(coalesce(p_description, ''));
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_app_version text := btrim(coalesce(p_app_version, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_file_name text := btrim(coalesce(p_attachment_file_name, ''));
  v_mime_type text := lower(btrim(coalesce(p_attachment_mime_type, '')));
  v_has_attachment boolean;
  v_extension text;
  v_storage_path text;
  v_created_at timestamptz := clock_timestamp();
  v_attachment_uploaded_at timestamptz;
  v_request_hash text;
  v_request_replayed boolean := false;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_expected_owner_id is null or p_expected_owner_id <> v_owner_id then
    raise exception using errcode = '42501', message = 'cloud_session_changed';
  end if;
  if p_client_request_id is null then
    raise exception using errcode = '22023', message = 'invalid_feedback_request_id';
  end if;

  if v_kind not in ('bug', 'feedback') then
    raise exception using errcode = '22023', message = 'invalid_feedback_kind';
  end if;
  if char_length(v_description) not between 1 and 10000
     or octet_length(v_description) > 40000 then
    raise exception using errcode = '22023', message = 'invalid_feedback_description';
  end if;
  if v_source not in ('assistant', 'settings') then
    raise exception using errcode = '22023', message = 'invalid_feedback_source';
  end if;
  if jsonb_typeof(v_context) <> 'object' or octet_length(v_context::text) > 4096 then
    raise exception using errcode = '22023', message = 'invalid_feedback_context';
  end if;
  if char_length(v_app_version) > 80 or char_length(v_platform) > 40 then
    raise exception using errcode = '22023', message = 'invalid_feedback_environment';
  end if;

  v_has_attachment :=
    p_attachment_file_name is not null
    or p_attachment_mime_type is not null
    or p_attachment_size_bytes is not null;
  if v_has_attachment and (
    p_attachment_file_name is null
    or p_attachment_mime_type is null
    or p_attachment_size_bytes is null
  ) then
    raise exception using errcode = '22023', message = 'incomplete_feedback_attachment';
  end if;
  if v_has_attachment then
    if char_length(v_file_name) not between 1 and 240 then
      raise exception using errcode = '22023', message = 'invalid_feedback_attachment_name';
    end if;
    if v_mime_type not in ('image/png', 'image/jpeg') then
      raise exception using errcode = '22023', message = 'invalid_feedback_attachment_type';
    end if;
    if p_attachment_size_bytes not between 1 and 8388608 then
      raise exception using errcode = '22023', message = 'invalid_feedback_attachment_size';
    end if;
  end if;
  v_request_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          v_kind,
          v_description,
          v_source,
          v_context,
          v_app_version,
          v_platform,
          case
            when v_has_attachment then jsonb_build_array(
              v_file_name,
              v_mime_type,
              p_attachment_size_bytes
            )
            else null
          end
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text, 20260724)
  );

  -- Clear abandoned pre-upload reservations once they cannot be a legitimate
  -- in-flight request. The request hash on the durable report lets an exact
  -- retry reserve a fresh attachment row without duplicating the report.
  delete from public.feedback_attachments as attachment
  where attachment.owner_id = v_owner_id
    and attachment.uploaded_at is null
    and attachment.created_at < clock_timestamp() - interval '24 hours'
    and not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'feedback-attachments'
        and object.name = attachment.storage_path
    );

  -- A renderer may lose its response if the Cloud account changes immediately
  -- after commit. Return the original row for an exact retry instead of creating
  -- a duplicate. A reused key with different content fails closed.
  select
    report.id,
    attachment.id,
    attachment.storage_path,
    report.created_at,
    attachment.uploaded_at
  into
    v_report_id,
    v_attachment_id,
    v_storage_path,
    v_created_at,
    v_attachment_uploaded_at
  from public.feedback_reports as report
  left join public.feedback_attachments as attachment
    on attachment.report_id = report.id
    and attachment.owner_id = report.owner_id
  where report.owner_id = v_owner_id
    and report.client_request_id = p_client_request_id
    and report.request_hash = v_request_hash;
  v_request_replayed := v_report_id is not null;
  if v_report_id is null and exists (
      select 1
      from public.feedback_reports as report
      where report.owner_id = v_owner_id
        and report.client_request_id = p_client_request_id
    ) then
    raise exception using errcode = '22023', message = 'feedback_request_id_conflict';
  end if;

  if v_report_id is null then
    if (
      select count(*)
      from public.feedback_reports as report
      where report.owner_id = v_owner_id
    ) >= 500 then
      raise exception using errcode = '54000', message = 'owner_feedback_report_quota_exceeded';
    end if;
    v_created_at := clock_timestamp();
    insert into public.feedback_reports (
      id,
      owner_id,
      client_request_id,
      request_hash,
      kind,
      description,
      source,
      context,
      app_version,
      platform,
      created_at,
      updated_at
    ) values (
      extensions.gen_random_uuid(),
      v_owner_id,
      p_client_request_id,
      v_request_hash,
      v_kind,
      v_description,
      v_source,
      v_context,
      v_app_version,
      v_platform,
      v_created_at,
      v_created_at
    )
    returning id into v_report_id;
  end if;

  if v_has_attachment and v_attachment_id is null then
    if coalesce((
      select sum(attachment.size_bytes)
      from public.feedback_attachments as attachment
      where attachment.owner_id = v_owner_id
    ), 0) + p_attachment_size_bytes > 104857600 then
      raise exception using errcode = '54000', message = 'owner_feedback_storage_quota_exceeded';
    end if;
    v_attachment_id := extensions.gen_random_uuid();
    v_extension := case v_mime_type
      when 'image/png' then 'png'
      when 'image/jpeg' then 'jpg'
    end;
    v_storage_path := format(
      '%s/%s/%s.%s',
      v_owner_id,
      v_report_id,
      v_attachment_id,
      v_extension
    );
    insert into public.feedback_attachments (
      id,
      report_id,
      owner_id,
      storage_path,
      file_name,
      mime_type,
      size_bytes,
      created_at
    ) values (
      v_attachment_id,
      v_report_id,
      v_owner_id,
      v_storage_path,
      v_file_name,
      v_mime_type,
      p_attachment_size_bytes,
      clock_timestamp()
    );
  end if;

  return query
  select
    v_report_id,
    v_attachment_id,
    v_storage_path,
    v_created_at,
    v_attachment_uploaded_at,
    v_request_replayed;
end;
$$;

create or replace function public.finalize_feedback_attachment(
  p_report_id uuid,
  p_attachment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_changed bigint;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  update public.feedback_attachments as attachment
  set uploaded_at = clock_timestamp()
  where attachment.id = p_attachment_id
    and attachment.report_id = p_report_id
    and attachment.owner_id = v_owner_id
    and attachment.uploaded_at is null
    and exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'feedback-attachments'
        and object.name = attachment.storage_path
        and coalesce(object.metadata ->> 'size', '') = attachment.size_bytes::text
        and lower(coalesce(object.metadata ->> 'mimetype', '')) = attachment.mime_type
    );
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

create or replace function public.discard_feedback_attachment(
  p_report_id uuid,
  p_attachment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_changed bigint;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  delete from public.feedback_attachments as attachment
  where attachment.id = p_attachment_id
    and attachment.report_id = p_report_id
    and attachment.owner_id = v_owner_id
    and attachment.uploaded_at is null
    and not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'feedback-attachments'
        and object.name = attachment.storage_path
    );
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

create or replace function public.recover_feedback_attachments()
returns table (
  report_id uuid,
  attachment_id uuid,
  storage_path text,
  mime_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  update public.feedback_attachments as attachment
  set uploaded_at = clock_timestamp()
  where attachment.owner_id = v_owner_id
    and attachment.uploaded_at is null
    and exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'feedback-attachments'
        and object.name = attachment.storage_path
        and coalesce(object.metadata ->> 'size', '') = attachment.size_bytes::text
        and lower(coalesce(object.metadata ->> 'mimetype', '')) = attachment.mime_type
    );
  delete from public.feedback_attachments as attachment
  where attachment.owner_id = v_owner_id
    and attachment.uploaded_at is null
    and attachment.created_at < clock_timestamp() - interval '24 hours'
    and not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = 'feedback-attachments'
        and object.name = attachment.storage_path
    );
  return query
  select
    attachment.report_id,
    attachment.id,
    attachment.storage_path,
    attachment.mime_type
  from public.feedback_attachments as attachment
  where attachment.owner_id = v_owner_id
    and attachment.uploaded_at is null
    and attachment.created_at < clock_timestamp() - interval '24 hours'
  order by attachment.created_at
  limit 25;
end;
$$;

revoke execute on function public.create_feedback_report(
  uuid, uuid, text, text, text, jsonb, text, text, text, text, bigint
) from public, anon;
revoke execute on function public.finalize_feedback_attachment(uuid, uuid) from public, anon;
revoke execute on function public.discard_feedback_attachment(uuid, uuid) from public, anon;
revoke execute on function public.recover_feedback_attachments() from public, anon;

grant execute on function public.create_feedback_report(
  uuid, uuid, text, text, text, jsonb, text, text, text, text, bigint
) to authenticated, service_role;
grant execute on function public.finalize_feedback_attachment(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.discard_feedback_attachment(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.recover_feedback_attachments()
  to authenticated, service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  8388608,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy feedback_attachments_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.feedback_attachments as attachment
    where attachment.owner_id = (select auth.uid())
      and attachment.storage_path = name
      and attachment.uploaded_at is null
      and coalesce(metadata ->> 'size', '') = attachment.size_bytes::text
      and lower(coalesce(metadata ->> 'mimetype', '')) = attachment.mime_type
  )
);

-- Standard uploads use INSERT ... RETURNING, so Storage also evaluates SELECT
-- RLS while the attachment is still pending. Limit that visibility to the
-- upload operation instead of making pending objects generally downloadable.
create policy feedback_attachments_storage_upload_select
on storage.objects for select
to authenticated
using (
  storage.allow_only_operation('object.upload')
  and bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.feedback_attachments as attachment
    where attachment.owner_id = (select auth.uid())
      and attachment.storage_path = name
      and attachment.uploaded_at is null
      and coalesce(metadata ->> 'size', '') = attachment.size_bytes::text
      and lower(coalesce(metadata ->> 'mimetype', '')) = attachment.mime_type
  )
);

create policy feedback_attachments_storage_select
on storage.objects for select
to authenticated
using (
  storage.allow_only_operation('object.get_authenticated')
  and bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.feedback_attachments as attachment
    where attachment.owner_id = (select auth.uid())
      and attachment.storage_path = name
      and attachment.uploaded_at is not null
  )
);

-- Removing an ambiguous or failed pending upload uses the batch delete route,
-- which evaluates SELECT as well as DELETE RLS.
create policy feedback_attachments_storage_delete_select
on storage.objects for select
to authenticated
using (
  storage.allow_any_operation(array['object.delete', 'object.delete_many'])
  and bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.feedback_attachments as attachment
    where attachment.owner_id = (select auth.uid())
      and attachment.storage_path = name
      and attachment.uploaded_at is null
  )
);

create policy feedback_attachments_storage_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'feedback-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.feedback_attachments as attachment
    where attachment.owner_id = (select auth.uid())
      and attachment.storage_path = name
      and attachment.uploaded_at is null
  )
);

commit;
