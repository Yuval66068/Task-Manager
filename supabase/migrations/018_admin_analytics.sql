-- Stage: private admin analytics dashboard.
--
-- This migration is strictly additive on top of 017_analytics_events.sql. It
-- does not alter or remove the existing analytics_events table, policies, or
-- app_open/login tracking. It adds:
--
--   1. public.analytics_admins - a private allowlist table (RLS enabled, no
--      client mutation, no anonymous access).
--   2. private.is_analytics_admin(uuid) - a SECURITY DEFINER helper used by
--      every admin RPC to independently verify the caller is an admin.
--   3. private.external_family_ids() - a SECURITY DEFINER helper that resolves
--      the set of "external" (non-owner, non-test) family ids for the calling
--      admin. This logic lives entirely server-side.
--   4. public.get_admin_analytics_summary() - aggregate Beta usage metrics.
--   5. public.get_admin_family_activity() - one row per external family with
--      non-identifying activity metadata.
--
-- No admin user is seeded here. See the report returned by this session for
-- the exact SQL the product owner must run manually to add themselves.

-- ============================================================
-- 1. analytics_admins allowlist
-- ============================================================

create table if not exists public.analytics_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.analytics_admins enable row level security;

-- No policies are created for authenticated/anon: this table is intentionally
-- inaccessible directly from the client. All reads happen inside SECURITY
-- DEFINER functions below. Revoke everything from public/anon/authenticated
-- and only allow service_role (used for manual/administrative maintenance).
revoke all on table public.analytics_admins from public;
revoke all on table public.analytics_admins from anon;
revoke all on table public.analytics_admins from authenticated;
grant all on table public.analytics_admins to service_role;

comment on table public.analytics_admins is
  'Allowlist of user_ids permitted to call admin analytics RPCs. No client-side access; managed manually via service_role/SQL.';

-- ============================================================
-- 2. is_analytics_admin helper
-- ============================================================

create or replace function private.is_analytics_admin(p_user_id uuid)
returns boolean
security definer
set search_path = ''
language sql
stable
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.analytics_admins aa
      where aa.user_id = p_user_id
    );
$$;

revoke all on function private.is_analytics_admin(uuid) from public;
revoke all on function private.is_analytics_admin(uuid) from anon;
grant execute on function private.is_analytics_admin(uuid) to service_role;
-- The private schema is not exposed through the client API, so granting
-- execute to authenticated here only allows this function to be evaluated
-- from within RLS policies (e.g. on analytics_events below); it does not let
-- clients call it directly as an RPC.
grant execute on function private.is_analytics_admin(uuid) to authenticated;

-- ============================================================
-- 3. external_family_ids helper
--
-- Resolves the set of family ids that should be visible to the calling
-- admin: excludes the admin's own family/families and known
-- infrastructure/test families (RLS_TEST_FAMILY_* prefix, or name exactly
-- "test" case-insensitive).
-- ============================================================

create or replace function private.external_family_ids(p_admin_id uuid)
returns table (family_id uuid)
security definer
set search_path = ''
language sql
stable
as $$
  select f.id
  from public.families f
  where f.id not in (
    select fm.family_id
    from public.family_members fm
    where fm.user_id = p_admin_id
  )
  and f.name !~* '^RLS_TEST_FAMILY_'
  and lower(trim(f.name)) <> 'test';
$$;

revoke all on function private.external_family_ids(uuid) from public;
revoke all on function private.external_family_ids(uuid) from anon;
revoke all on function private.external_family_ids(uuid) from authenticated;
grant execute on function private.external_family_ids(uuid) to service_role;

-- ============================================================
-- 4. get_admin_analytics_summary()
-- ============================================================

create or replace function public.get_admin_analytics_summary()
returns table (
  total_external_families bigint,
  new_families_today bigint,
  new_families_7d bigint,
  new_families_30d bigint,
  opened_app_today bigint,
  opened_app_7d bigint,
  opened_app_30d bigint,
  logged_in_today bigint,
  logged_in_7d bigint,
  logged_in_30d bigint,
  families_with_child bigint,
  families_with_task bigint,
  families_with_completion bigint,
  families_with_reward_redemption bigint,
  task_completions_today bigint,
  task_completions_7d bigint,
  task_completions_30d bigint,
  active_families_today bigint,
  active_families_7d bigint,
  active_families_30d bigint,
  pct_added_child numeric,
  pct_created_task numeric,
  pct_completed_task numeric
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_admin_id uuid := auth.uid();
  v_today timestamptz := date_trunc('day', now());
  v_7d timestamptz := now() - interval '7 days';
  v_30d timestamptz := now() - interval '30 days';
  v_total_external bigint := 0;
  v_families_with_child bigint := 0;
  v_families_with_task bigint := 0;
  v_families_with_completion bigint := 0;
  v_families_with_redemption bigint := 0;
begin
  if v_admin_id is null or not private.is_analytics_admin(v_admin_id) then
    raise exception 'not authorized';
  end if;

  create temporary table _external_families on commit drop as
  select ef.family_id
  from private.external_family_ids(v_admin_id) ef;

  select count(*) into v_total_external from _external_families;

  select count(distinct fm.family_id) into v_families_with_child
  from public.family_members fm
  join _external_families ef on ef.family_id = fm.family_id
  where fm.role = 'child';

  select count(distinct t.family_id) into v_families_with_task
  from public.tasks t
  join _external_families ef on ef.family_id = t.family_id;

  select count(distinct t.family_id) into v_families_with_completion
  from public.task_completions tc
  join public.tasks t on t.id = tc.task_id
  join _external_families ef on ef.family_id = t.family_id
  where tc.status in ('submitted', 'approved');

  select count(distinct r.family_id) into v_families_with_redemption
  from public.user_rewards ur
  join public.rewards r on r.id = ur.reward_id
  join _external_families ef on ef.family_id = r.family_id
  where ur.status = 'approved';

  return query
  select
    v_total_external,

    (select count(*) from public.families f join _external_families ef on ef.family_id = f.id
      where f.created_at >= v_today),
    (select count(*) from public.families f join _external_families ef on ef.family_id = f.id
      where f.created_at >= v_7d),
    (select count(*) from public.families f join _external_families ef on ef.family_id = f.id
      where f.created_at >= v_30d),

    (select count(distinct ae.family_id) from public.analytics_events ae join _external_families ef on ef.family_id = ae.family_id
      where ae.event_name = 'app_open' and ae.created_at >= v_today),
    (select count(distinct ae.family_id) from public.analytics_events ae join _external_families ef on ef.family_id = ae.family_id
      where ae.event_name = 'app_open' and ae.created_at >= v_7d),
    (select count(distinct ae.family_id) from public.analytics_events ae join _external_families ef on ef.family_id = ae.family_id
      where ae.event_name = 'app_open' and ae.created_at >= v_30d),

    (select count(distinct ae.family_id) from public.analytics_events ae join _external_families ef on ef.family_id = ae.family_id
      where ae.event_name = 'login' and ae.created_at >= v_today),
    (select count(distinct ae.family_id) from public.analytics_events ae join _external_families ef on ef.family_id = ae.family_id
      where ae.event_name = 'login' and ae.created_at >= v_7d),
    (select count(distinct ae.family_id) from public.analytics_events ae join _external_families ef on ef.family_id = ae.family_id
      where ae.event_name = 'login' and ae.created_at >= v_30d),

    v_families_with_child,
    v_families_with_task,
    v_families_with_completion,
    v_families_with_redemption,

    (select count(*) from public.task_completions tc
      join public.tasks t on t.id = tc.task_id
      join _external_families ef on ef.family_id = t.family_id
      where tc.status = 'approved' and tc.reviewed_at >= v_today),
    (select count(*) from public.task_completions tc
      join public.tasks t on t.id = tc.task_id
      join _external_families ef on ef.family_id = t.family_id
      where tc.status = 'approved' and tc.reviewed_at >= v_7d),
    (select count(*) from public.task_completions tc
      join public.tasks t on t.id = tc.task_id
      join _external_families ef on ef.family_id = t.family_id
      where tc.status = 'approved' and tc.reviewed_at >= v_30d),

    (select count(*) from (
      select ef.family_id from _external_families ef
      where exists (select 1 from public.analytics_events ae where ae.family_id = ef.family_id and ae.event_name = 'app_open' and ae.created_at >= v_today)
         or exists (select 1 from public.tasks t where t.family_id = ef.family_id and t.created_at >= v_today)
         or exists (select 1 from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = ef.family_id and tc.submitted_at >= v_today)
         or exists (select 1 from public.user_rewards ur join public.rewards r on r.id = ur.reward_id where r.family_id = ef.family_id and ur.requested_at >= v_today)
    ) active_today),
    (select count(*) from (
      select ef.family_id from _external_families ef
      where exists (select 1 from public.analytics_events ae where ae.family_id = ef.family_id and ae.event_name = 'app_open' and ae.created_at >= v_7d)
         or exists (select 1 from public.tasks t where t.family_id = ef.family_id and t.created_at >= v_7d)
         or exists (select 1 from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = ef.family_id and tc.submitted_at >= v_7d)
         or exists (select 1 from public.user_rewards ur join public.rewards r on r.id = ur.reward_id where r.family_id = ef.family_id and ur.requested_at >= v_7d)
    ) active_7d),
    (select count(*) from (
      select ef.family_id from _external_families ef
      where exists (select 1 from public.analytics_events ae where ae.family_id = ef.family_id and ae.event_name = 'app_open' and ae.created_at >= v_30d)
         or exists (select 1 from public.tasks t where t.family_id = ef.family_id and t.created_at >= v_30d)
         or exists (select 1 from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = ef.family_id and tc.submitted_at >= v_30d)
         or exists (select 1 from public.user_rewards ur join public.rewards r on r.id = ur.reward_id where r.family_id = ef.family_id and ur.requested_at >= v_30d)
    ) active_30d),

    case when v_total_external > 0 then round((v_families_with_child::numeric / v_total_external) * 100, 1) else 0 end,
    case when v_total_external > 0 then round((v_families_with_task::numeric / v_total_external) * 100, 1) else 0 end,
    case when v_total_external > 0 then round((v_families_with_completion::numeric / v_total_external) * 100, 1) else 0 end;
end;
$$;

revoke all on function public.get_admin_analytics_summary() from public;
revoke all on function public.get_admin_analytics_summary() from anon;
grant execute on function public.get_admin_analytics_summary() to authenticated;

comment on function public.get_admin_analytics_summary() is
  'Admin-only aggregate Beta usage metrics for external families. Verifies analytics_admins membership internally.';

-- ============================================================
-- 5. get_admin_family_activity()
-- ============================================================

create or replace function public.get_admin_family_activity()
returns table (
  family_id uuid,
  family_name text,
  created_at timestamptz,
  child_count bigint,
  task_count bigint,
  completion_count bigint,
  reward_redemption_count bigint,
  last_app_open_at timestamptz,
  last_login_at timestamptz,
  last_task_activity_at timestamptz,
  last_activity_at timestamptz
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_admin_id uuid := auth.uid();
begin
  if v_admin_id is null or not private.is_analytics_admin(v_admin_id) then
    raise exception 'not authorized';
  end if;

  return query
  select
    f.id,
    f.name,
    f.created_at,
    coalesce((select count(*) from public.family_members fm where fm.family_id = f.id and fm.role = 'child'), 0),
    coalesce((select count(*) from public.tasks t where t.family_id = f.id), 0),
    coalesce((select count(*) from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = f.id and tc.status = 'approved'), 0),
    coalesce((select count(*) from public.user_rewards ur join public.rewards r on r.id = ur.reward_id where r.family_id = f.id and ur.status = 'approved'), 0),
    (select max(ae.created_at) from public.analytics_events ae where ae.family_id = f.id and ae.event_name = 'app_open'),
    (select max(ae.created_at) from public.analytics_events ae where ae.family_id = f.id and ae.event_name = 'login'),
    (select max(activity_at) from (
      select t.created_at as activity_at from public.tasks t where t.family_id = f.id
      union all
      select tc.submitted_at as activity_at from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = f.id
    ) task_activity),
    greatest(
      f.created_at,
      coalesce((select max(ae.created_at) from public.analytics_events ae where ae.family_id = f.id), 'epoch'::timestamptz),
      coalesce((select max(t.created_at) from public.tasks t where t.family_id = f.id), 'epoch'::timestamptz),
      coalesce((select max(tc.submitted_at) from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = f.id), 'epoch'::timestamptz),
      coalesce((select max(ur.requested_at) from public.user_rewards ur join public.rewards r on r.id = ur.reward_id where r.family_id = f.id), 'epoch'::timestamptz)
    )
  from public.families f
  where f.id in (select ef.family_id from private.external_family_ids(v_admin_id) ef)
  order by
    greatest(
      f.created_at,
      coalesce((select max(ae.created_at) from public.analytics_events ae where ae.family_id = f.id), 'epoch'::timestamptz),
      coalesce((select max(t.created_at) from public.tasks t where t.family_id = f.id), 'epoch'::timestamptz),
      coalesce((select max(tc.submitted_at) from public.task_completions tc join public.tasks t on t.id = tc.task_id where t.family_id = f.id), 'epoch'::timestamptz),
      coalesce((select max(ur.requested_at) from public.user_rewards ur join public.rewards r on r.id = ur.reward_id where r.family_id = f.id), 'epoch'::timestamptz)
    ) desc nulls last;
end;
$$;

revoke all on function public.get_admin_family_activity() from public;
revoke all on function public.get_admin_family_activity() from anon;
grant execute on function public.get_admin_family_activity() to authenticated;

comment on function public.get_admin_family_activity() is
  'Admin-only per-family activity summary for external families, excluding any PII (no emails, names, PINs, usernames, tokens).';

-- ============================================================
-- 6. Admin-only SELECT access to analytics_events (for Realtime)
--
-- The AnalyticsDashboard subscribes to Postgres Changes (INSERT) on
-- analytics_events. Supabase Realtime enforces RLS, so without a SELECT
-- policy analytics admins would never receive those change events even
-- though the admin RPCs above already independently verify authorization.
-- This does not alter the existing insert-only policy from 017.
-- ============================================================

create policy "Analytics admins can read analytics events"
on public.analytics_events
for select
to authenticated
using (
  private.is_analytics_admin(auth.uid())
);

grant select on public.analytics_events to authenticated;

-- ============================================================
-- 7. Ensure analytics_events is part of the supabase_realtime publication
--
-- Idempotent: only adds the table if it is not already a member, so this
-- migration is safe to run even if analytics_events was already enabled for
-- Postgres Changes.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'analytics_events'
    )
  then
    alter publication supabase_realtime add table public.analytics_events;
  end if;
end;
$$;
