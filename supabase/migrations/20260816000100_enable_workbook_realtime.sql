-- Publish owner-scoped workbook metadata so clients can notice a newer Cloud
-- revision without streaming portable workbook snapshots. RLS remains the
-- authorization boundary for authenticated Realtime subscribers.

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication as publication
    join pg_catalog.pg_publication_rel as published_relation
      on published_relation.prpubid = publication.oid
    join pg_catalog.pg_class as relation
      on relation.oid = published_relation.prrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where publication.pubname = 'supabase_realtime'
      and namespace.nspname = 'public'
      and relation.relname = 'workbooks'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
      and puballtables
  ) then
    alter publication supabase_realtime add table public.workbooks;
  end if;
end;
$migration$;

alter table public.workbooks enable row level security;
alter table public.workbooks force row level security;
