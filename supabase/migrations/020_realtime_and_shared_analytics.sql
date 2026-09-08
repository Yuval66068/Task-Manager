-- Stage: realtime hardening + shared analytics-admin visibility.
--
-- This migration is strictly additive on top of 019_prevent_duplicate_family_membership.sql.
-- It does not rewrite or remove any previous migration. It adds:
--
--   1. Idempotent Supabase Realtime publication membership for the core
--      family-data tables plus analytics_events.
--   2. public.analytics_internal_families - an explicit internal/owner family
--      exclusion list, seeded once from families belonging to CURRENT
--      analytics_admins entries at migration time.
--   3. An updated private.external_family_ids(uuid) that excludes families in
--      analytics_internal_families (not the calling admin's own family), so
--      every analytics admin sees the same external-family dataset.
--   4. Lightweight SECURITY DEFINER trigger functions that insert wake-up
--      analytics_events rows for canonical activity (family created, child
--      added, task created, task completion activity, reward activity).
--      These events are activity signals only; the admin RPCs above remain
--      the sole source of metric values.
--
-- No metric/funnel/completion/redemption definitions are changed here.

-- ============================================================
-- 1. Realtime publication hardening (idempotent)
-- ============================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'families',
    'family_members',
    'profiles',
    'tasks',
    'task_completions',
    'notifications',
    'rewards',
    'user_rewards',
    'achievements',
    'user_achievements',
    'analytics_events'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array v_tables loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

-- ============================================================
-- 2. analytics_internal_families
-- ============================================================

create table if not exists public.analytics_internal_families (
  family_id uuid primary key references public.families (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.analytics_internal_families enable row level security;

revoke all on table public.analytics_internal_families from public;
revoke all on table public.analytics_internal_families from anon;
revoke all on table public.analytics_internal_families from authenticated;
grant all on table public.analytics_internal_families to service_role;

comment on table public.analytics_internal_families is
  'Explicit internal/owner/test family exclusion list for admin analytics. Seeded once from families belonging to the current analytics_admins at migration time; future analytics admins'' families are NOT auto-added here.';

-- One-time seed only: on the FIRST execution of this migration (when
-- analytics_internal_families is still completely empty), seed it with the
-- family/families belonging to whoever is CURRENTLY an analytics admin at
-- that moment. This intentionally captures the existing product-owner/admin
-- family as internal so it keeps being excluded from external metrics.
--
-- The "where not exists (select 1 from public.analytics_internal_families)"
-- guard ensures this insert only ever fires once, on a table with zero
-- rows. If this migration file is ever manually re-run after the table has
-- already been seeded (or after rows were added/removed manually), no
-- additional analytics-admin families are inserted -- so a future analytics
-- admin (a real Beta-family parent) added after the initial seed will NOT
-- have their family retroactively marked internal by re-running this SQL.
-- ON CONFLICT DO NOTHING is kept as a second safety net, and existing rows
-- (whether seeded here or added manually) are always preserved untouched.
insert into public.analytics_internal_families (family_id, reason)
select distinct fm.family_id, 'seeded from analytics_admins at migration time'
from public.analytics_admins aa
join public.family_members fm on fm.user_id = aa.user_id
where not exists (select 1 from public.analytics_internal_families)
on conflict (family_id) do nothing;

-- ============================================================
-- 3. Updated external_family_ids: internal-family list, not "current admin"
-- ============================================================
--
-- Signature is preserved for compatibility (existing callers/RPCs are
-- unaffected), but p_admin_id is no longer used to exclude "the calling
-- admin's own family" -- it remains only because callers already pass it and
-- changing the signature would require touching every call site. Every
-- authorized analytics admin now receives the exact same external-family
-- set, derived from analytics_internal_families instead of the caller's own
-- membership.

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
    select aif.family_id
    from public.analytics_internal_families aif
  )
  and f.name !~* '^RLS_TEST_FAMILY_'
  and lower(trim(f.name)) <> 'test';
$$;

revoke all on function private.external_family_ids(uuid) from public;
revoke all on function private.external_family_ids(uuid) from anon;
revoke all on function private.external_family_ids(uuid) from authenticated;
grant execute on function private.external_family_ids(uuid) to service_role;

comment on function private.external_family_ids(uuid) is
  'Resolves the external (non-internal, non-test) family set shared identically by every analytics admin. Excludes analytics_internal_families entries plus RLS_TEST_FAMILY_* / "test" named families. The p_admin_id parameter is kept only for call-site compatibility and no longer excludes the caller''s own family.';

-- ============================================================
-- 4. Canonical-activity wake-up signals for analytics_events
--
-- These triggers are activity signals only: they let the AnalyticsDashboard
-- realtime subscription (on analytics_events INSERT) wake up promptly when
-- meaningful canonical activity happens, without requiring the client to
-- have already called trackEvent(). Their payload is never used to compute
-- dashboard metrics -- the admin RPCs always re-derive everything from the
-- canonical tables. No trigger is placed on analytics_events itself, so
-- there is no possibility of an infinite loop.
-- ============================================================

create or replace function private.log_family_created_activity()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  insert into public.analytics_events (family_id, user_id, event_name)
  values (new.id, null, 'family_created');
  return new;
end;
$$;

revoke all on function private.log_family_created_activity() from public;
revoke all on function private.log_family_created_activity() from anon;
revoke all on function private.log_family_created_activity() from authenticated;

drop trigger if exists analytics_log_family_created on public.families;
create trigger analytics_log_family_created
  after insert on public.families
  for each row execute function private.log_family_created_activity();

create or replace function private.log_child_added_activity()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  if new.role = 'child' then
    insert into public.analytics_events (family_id, user_id, event_name)
    values (new.family_id, new.user_id, 'child_added');
  end if;
  return new;
end;
$$;

revoke all on function private.log_child_added_activity() from public;
revoke all on function private.log_child_added_activity() from anon;
revoke all on function private.log_child_added_activity() from authenticated;

drop trigger if exists analytics_log_child_added on public.family_members;
create trigger analytics_log_child_added
  after insert on public.family_members
  for each row execute function private.log_child_added_activity();

create or replace function private.log_task_created_activity()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  insert into public.analytics_events (family_id, user_id, event_name)
  values (new.family_id, new.created_by, 'task_created');
  return new;
end;
$$;

revoke all on function private.log_task_created_activity() from public;
revoke all on function private.log_task_created_activity() from anon;
revoke all on function private.log_task_created_activity() from authenticated;

drop trigger if exists analytics_log_task_created on public.tasks;
create trigger analytics_log_task_created
  after insert on public.tasks
  for each row execute function private.log_task_created_activity();

create or replace function private.log_task_completion_activity()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  select t.family_id into v_family_id
  from public.tasks t
  where t.id = new.task_id;

  if v_family_id is not null then
    insert into public.analytics_events (family_id, user_id, event_name)
    values (v_family_id, new.child_id, 'task_completion_activity');
  end if;

  return new;
end;
$$;

revoke all on function private.log_task_completion_activity() from public;
revoke all on function private.log_task_completion_activity() from anon;
revoke all on function private.log_task_completion_activity() from authenticated;

drop trigger if exists analytics_log_task_completion on public.task_completions;
create trigger analytics_log_task_completion
  after insert or update of status on public.task_completions
  for each row execute function private.log_task_completion_activity();

create or replace function private.log_reward_activity()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  select r.family_id into v_family_id
  from public.rewards r
  where r.id = new.reward_id;

  if v_family_id is not null then
    insert into public.analytics_events (family_id, user_id, event_name)
    values (v_family_id, new.user_id, 'reward_activity');
  end if;

  return new;
end;
$$;

revoke all on function private.log_reward_activity() from public;
revoke all on function private.log_reward_activity() from anon;
revoke all on function private.log_reward_activity() from authenticated;

drop trigger if exists analytics_log_reward_activity on public.user_rewards;
create trigger analytics_log_reward_activity
  after insert or update of status on public.user_rewards
  for each row execute function private.log_reward_activity();
