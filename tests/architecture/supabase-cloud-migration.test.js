import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDirectory = resolve('supabase/migrations');
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const migrationSource = migrationFiles
  .map((name) => readFileSync(resolve(migrationsDirectory, name), 'utf8'))
  .join('\n');

const cloudTables = [
  'profiles',
  'devices',
  'workbooks',
  'workbook_versions',
  'sync_audit_events',
  'feedback_reports',
  'feedback_attachments'
];

describe('Supabase Cavalry Cloud migration', () => {
  it('creates the multi-workbook ownership and history model', () => {
    expect(migrationFiles).toContain('20260720000100_cavalry_cloud.sql');
    cloudTables.forEach((table) => {
      expect(migrationSource).toMatch(new RegExp(`create table public\\.${table} \\(`, 'i'));
    });

    expect(migrationSource).toMatch(/unique\s*\(owner_id,\s*local_workbook_id\)/i);
    expect(migrationSource).toMatch(/unique\s*\(workbook_record_id,\s*revision\)/i);
    expect(migrationSource).toContain('portable_html text not null');
    expect(migrationSource).toContain('latest_revision bigint not null default 0');
    expect(migrationSource).toContain('references auth.users (id) on delete cascade');
  });

  it('forces owner-only RLS on every exposed cloud table', () => {
    cloudTables.forEach((table) => {
      expect(migrationSource).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security;`, 'i')
      );
      expect(migrationSource).toMatch(
        new RegExp(`alter table public\\.${table} force row level security;`, 'i')
      );
    });

    expect(migrationSource.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(10);
    expect(
      migrationSource.match(/\(select auth\.uid\(\)\) = owner_id/g)?.length
    ).toBeGreaterThanOrEqual(7);
    expect(migrationSource).toContain('(select auth.uid()) = user_id');
    expect(migrationSource).not.toMatch(/create policy[\s\S]{0,160}to anon/i);
  });

  it('keeps snapshot and audit history append-only for authenticated clients', () => {
    expect(migrationSource).toContain(
      'grant select on table public.workbook_versions to authenticated;'
    );
    expect(migrationSource).toContain(
      'grant select on table public.sync_audit_events to authenticated;'
    );
    expect(migrationSource).not.toMatch(
      /grant\s+(?:all|insert|update|delete)[^;]*public\.workbook_versions\s+to authenticated/i
    );
    expect(migrationSource).not.toMatch(
      /grant\s+(?:all|insert|update|delete)[^;]*public\.sync_audit_events\s+to authenticated/i
    );
    expect(migrationSource).toContain('workbook_versions_reject_update');
    expect(migrationSource).toContain('sync_audit_events_reject_update');
    expect(migrationSource).toContain("message = 'cavalry_history_is_append_only'");
  });

  it('uses locked owner-scoped RPCs instead of direct workbook writes', () => {
    expect(migrationSource).toContain('create or replace function public.save_workbook_snapshot(');
    expect(migrationSource).toContain(
      'create or replace function public.download_workbook_snapshot('
    );
    expect(migrationSource).toContain('create or replace function public.delete_workbook(');
    expect(migrationSource).toMatch(
      /save_workbook_snapshot\(\s*p_local_workbook_id text,\s*p_name text,\s*p_year integer,\s*p_currency text,\s*p_schema_version integer,\s*p_portable_html text,\s*p_expected_revision bigint default null,\s*p_device_id uuid default null,\s*p_source_updated_at timestamptz default null\s*\)/i
    );
    expect(migrationSource).toMatch(
      /returns table \(\s*local_workbook_id text,\s*name text,\s*year integer,\s*currency text,\s*latest_revision bigint,\s*updated_at timestamptz\s*\)/i
    );
    expect(migrationSource).toMatch(
      /download_workbook_snapshot\(\s*p_local_workbook_id text\s*\)[\s\S]*?portable_html text[\s\S]*?security definer/i
    );
    expect(migrationSource).toMatch(
      /delete_workbook\(\s*p_local_workbook_id text\s*\)\s*returns boolean/i
    );
    expect(migrationSource).toMatch(
      /public\.save_workbook_snapshot\([\s\S]*?security definer[\s\S]*?set search_path = ''/i
    );
    expect(migrationSource).toContain('v_owner_id uuid := (select auth.uid())');
    expect(migrationSource).toContain('for update;');
    expect(migrationSource).toContain(
      'on conflict on constraint workbooks_owner_workbook_unique do nothing;'
    );
    expect(migrationSource).not.toContain('on conflict (owner_id, local_workbook_id) do nothing;');
    expect(migrationSource).toContain(
      'p_expected_revision is distinct from v_workbook.latest_revision'
    );
    expect(migrationSource).toContain("errcode = '40001'");
    expect(migrationSource).toContain("message = 'workbook_revision_conflict'");
    expect(migrationSource).toContain('v_next_revision := v_workbook.latest_revision + 1');
    expect(migrationSource).toContain('insert into public.workbook_versions');
    expect(migrationSource).toContain('insert into public.sync_audit_events');
    expect(migrationSource).toContain(
      "extensions.digest(convert_to(p_portable_html, 'UTF8'), 'sha256')"
    );
    expect(migrationSource).toContain('grant execute on function public.save_workbook_snapshot(');
    expect(migrationSource).toContain(') to authenticated, service_role;');
    expect(migrationSource).not.toMatch(
      /grant\s+(?:all|insert|update|delete)[^;]*public\.workbooks\s+to authenticated/i
    );
  });

  it('enforces owner storage quotas inside the snapshot transaction', () => {
    expect(migrationSource).toContain('pg_catalog.pg_advisory_xact_lock(');
    expect(migrationSource).toContain("message = 'owner_workbook_quota_exceeded'");
    expect(migrationSource).toContain("message = 'owner_version_quota_exceeded'");
    expect(migrationSource).toContain("message = 'owner_storage_quota_exceeded'");
    expect(migrationSource).toContain("message = 'workbook_version_quota_exceeded'");
    expect(migrationSource).toContain('v_workbook.latest_revision >= 200');
    expect(migrationSource).toContain('> 524288000');
  });

  it('stores private owner-scoped feedback and image metadata', () => {
    expect(migrationFiles).toContain('20260724000100_cloud_feedback.sql');
    expect(migrationSource).toMatch(/create table public\.feedback_reports \(/i);
    expect(migrationSource).toMatch(/create table public\.feedback_attachments \(/i);
    expect(migrationSource).toMatch(
      /foreign key \(report_id,\s*owner_id\)[\s\S]*?references public\.feedback_reports \(id,\s*owner_id\)/i
    );
    expect(migrationSource).toMatch(/unique\s*\(report_id\)/i);
    expect(migrationSource).toMatch(
      /unique\s*\(owner_id,\s*client_request_id\)[\s\S]*?request_hash/i
    );
    expect(migrationSource).toMatch(/feedback_reports_kind[\s\S]*?'bug'[\s\S]*?'feedback'/i);
    expect(migrationSource).toMatch(/feedback_attachments_size[\s\S]*?8388608/i);
    expect(migrationSource).toMatch(/image\/png[\s\S]*?image\/jpeg/i);
    expect(migrationSource).not.toContain('image/webp');

    expect(migrationSource).toContain(
      'grant select on table public.feedback_reports to authenticated;'
    );
    expect(migrationSource).toContain(
      'grant select on table public.feedback_attachments to authenticated;'
    );
    expect(migrationSource).not.toMatch(
      /grant\s+(?:all|insert|update|delete)[^;]*public\.feedback_(?:reports|attachments)\s+to authenticated/i
    );
    expect(migrationSource).toContain('create or replace function public.create_feedback_report(');
    expect(migrationSource).toContain(
      'create or replace function public.finalize_feedback_attachment('
    );
    expect(migrationSource).toContain(
      'create or replace function public.discard_feedback_attachment('
    );
    expect(migrationSource).toContain(
      'create or replace function public.recover_feedback_attachments()'
    );
    expect(migrationSource).toMatch(
      /public\.create_feedback_report\([\s\S]*?security definer[\s\S]*?set search_path = ''/i
    );
    expect(migrationSource).toMatch(
      /create_feedback_report\(\s*p_expected_owner_id uuid,\s*p_client_request_id uuid[\s\S]*?p_expected_owner_id <> v_owner_id[\s\S]*?'cloud_session_changed'/i
    );
    expect(migrationSource).toMatch(
      /report\.client_request_id = p_client_request_id[\s\S]*?report\.request_hash = v_request_hash/i
    );
    expect(migrationSource).toMatch(
      /attachment\.created_at < clock_timestamp\(\) - interval '24 hours'[\s\S]*?not exists \([\s\S]*?storage\.objects/i
    );
    expect(migrationSource).toMatch(
      /recover_feedback_attachments\(\)[\s\S]*?set uploaded_at = clock_timestamp\(\)[\s\S]*?return query[\s\S]*?attachment\.storage_path/i
    );
    expect(migrationSource).toContain('v_owner_id uuid := (select auth.uid())');
  });

  it('creates a private feedback bucket with authenticated owner-path policies', () => {
    expect(migrationSource).toMatch(
      /insert into storage\.buckets[\s\S]*?'feedback-attachments'[\s\S]*?false[\s\S]*?8388608/i
    );
    expect(migrationSource).toMatch(/allowed_mime_types[\s\S]*?image\/png[\s\S]*?image\/jpeg/i);
    expect(migrationSource).toMatch(
      /create policy feedback_attachments_storage_insert[\s\S]*?on storage\.objects for insert[\s\S]*?to authenticated/i
    );
    expect(migrationSource).toMatch(
      /create policy feedback_attachments_storage_select[\s\S]*?on storage\.objects for select[\s\S]*?to authenticated/i
    );
    expect(migrationSource).toMatch(
      /create policy feedback_attachments_storage_upload_select[\s\S]*?storage\.allow_only_operation\('object\.upload'\)/i
    );
    expect(migrationSource).toMatch(
      /feedback_attachments_storage_select[\s\S]*?storage\.allow_only_operation\('object\.get_authenticated'\)/i
    );
    expect(migrationSource).toMatch(
      /feedback_attachments_storage_delete_select[\s\S]*?storage\.allow_any_operation\(array\['object\.delete',\s*'object\.delete_many'\]\)/i
    );
    expect(migrationSource).toMatch(
      /create policy feedback_attachments_storage_delete[\s\S]*?on storage\.objects for delete[\s\S]*?to authenticated/i
    );
    expect(migrationSource).toContain('(storage.foldername(name))[1] = (select auth.uid())::text');
    expect(migrationSource).toMatch(
      /storage\.objects[\s\S]*?exists \([\s\S]*?public\.feedback_attachments/i
    );
    expect(migrationSource).toMatch(/metadata\s*->>\s*'size'[\s\S]*?attachment\.size_bytes/i);
    expect(migrationSource).toMatch(/metadata\s*->>\s*'mimetype'[\s\S]*?attachment\.mime_type/i);
    expect(migrationSource).toMatch(
      /discard_feedback_attachment[\s\S]*?and not exists \([\s\S]*?from storage\.objects/i
    );
    expect(migrationSource).not.toMatch(
      /create policy feedback_attachments_storage_[\s\S]{0,240}?to anon/i
    );
    expect(migrationSource).not.toMatch(/update storage\.buckets[\s\S]*?public\s*=\s*true/i);
  });

  it('documents safe project setup without embedding credentials', () => {
    const setup = readFileSync(resolve('supabase/README.md'), 'utf8');

    expect(setup).toContain('supabase link --project-ref YOUR_PROJECT_REF');
    expect(setup).toContain('supabase db push');
    expect(readFileSync(resolve('supabase/config.toml'), 'utf8')).toContain(
      'additional_redirect_urls = ["cavalry://auth/callback"]'
    );
    expect(setup).toContain('workbook_revision_conflict');
    expect(setup).toMatch(/must never\s+retry with the new revision automatically/);
    expect(setup).toMatch(/Never ship a\s+secret key or `service_role` key/);
    expect(setup).toContain('feedback-attachments');
    expect(setup).toMatch(/desktop release workflow does not run `supabase db push`/i);
    expect(setup).not.toMatch(/(?:eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]+)/);
  });
});
