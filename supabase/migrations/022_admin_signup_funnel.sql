-- Admin-only signup/onboarding funnel analytics.
--
-- Adds two admin-only SECURITY DEFINER RPCs that summarize how users move
-- through signup -> confirmation -> onboarding -> first family activity.
-- Both RPCs read auth.users internally (required to know signup/confirm/
-- sign-in timestamps) but never expose raw auth.users rows, passwords,
-- tokens, provider identities, or other auth metadata to the client -- only
-- the specific derived fields listed below are returned.
--
-- 1. public.get_admin_signup_funnel(p_days integer default 30)
--    Returns one row per funnel stage with count, percentage_of_signups and
--    percentage_from_previous_stage, restricted to auth.users created within
--    the requested trailing window.
--
-- 2. public.get_admin_recent_signups(p_limit integer default 50)
--    Returns a per-user diagnostic table (signup timestamp, email, and
--    boolean flags for each funnel stage) for the most recent signups.
--
-- Both functions verify private.is_analytics_admin(auth.uid()) internally,
-- exactly like the existing get_admin_analytics_summary() /
-- get_admin_family_activity() RPCs from migration 018.

-- ============================================================
-- 1. get_admin_signup_funnel()
-- ============================================================

create or replace function public.get_admin_signup_funnel(p_days integer default 30)
returns table (
  stage text,
  count bigint,
  percentage_of_signups numeric,
  percentage_from_previous_stage numeric
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_admin_id uuid := auth.uid();
  v_since timestamptz;
  v_signup bigint := 0;
  v_confirmed bigint := 0;
  v_signed_in bigint := 0;
  v_profile bigint := 0;
  v_family bigint := 0;
  v_child bigint := 0;
  v_task bigint := 0;
begin
  if v_admin_id is null or not private.is_analytics_admin(v_admin_id) then
    raise exception 'not authorized';
  end if;

  if p_days is null or p_days <= 0 then
    p_days := 30;
  end if;

  v_since := now() - (p_days || ' days')::interval;

  -- Restrict the cohort to self-service new-parent signups only: child
  -- accounts, invited/additional parents and other non-primary auth.users
  -- rows never carry both onboarding metadata fields together.
  create temporary table _funnel_users on commit drop as
  select
    u.id as user_id,
    u.email_confirmed_at,
    u.last_sign_in_at
  from auth.users u
  where u.created_at >= v_since
    and nullif(trim(u.raw_user_meta_data ->> 'onboarding_full_name'), '') is not null
    and nullif(trim(u.raw_user_meta_data ->> 'onboarding_family_name'), '') is not null;

  select count(*) into v_signup from _funnel_users;

  select count(*) into v_confirmed
  from _funnel_users
  where email_confirmed_at is not null;

  select count(*) into v_signed_in
  from _funnel_users
  where last_sign_in_at is not null;

  select count(*) into v_profile
  from _funnel_users fu
  where exists (
    select 1 from public.profiles p where p.id = fu.user_id
  );

  select count(*) into v_family
  from _funnel_users fu
  where exists (
    select 1 from public.family_members fm where fm.user_id = fu.user_id
  );

  select count(*) into v_child
  from _funnel_users fu
  join public.family_members fm on fm.user_id = fu.user_id
  where exists (
    select 1
    from public.family_members fm2
    where fm2.family_id = fm.family_id
      and fm2.role = 'child'
  );

  select count(*) into v_task
  from _funnel_users fu
  join public.family_members fm on fm.user_id = fu.user_id
  where exists (
    select 1
    from public.tasks t
    where t.family_id = fm.family_id
  );

  return query
  select 'auth_signup'::text, v_signup,
    case when v_signup > 0 then round((v_signup::numeric / v_signup) * 100, 1) else 0 end,
    null::numeric
  union all
  select 'email_confirmed'::text, v_confirmed,
    case when v_signup > 0 then round((v_confirmed::numeric / v_signup) * 100, 1) else 0 end,
    case when v_signup > 0 then round((v_confirmed::numeric / v_signup) * 100, 1) else 0 end
  union all
  select 'signed_in'::text, v_signed_in,
    case when v_signup > 0 then round((v_signed_in::numeric / v_signup) * 100, 1) else 0 end,
    case when v_confirmed > 0 then round((v_signed_in::numeric / v_confirmed) * 100, 1) else 0 end
  union all
  select 'profile_created'::text, v_profile,
    case when v_signup > 0 then round((v_profile::numeric / v_signup) * 100, 1) else 0 end,
    case when v_signed_in > 0 then round((v_profile::numeric / v_signed_in) * 100, 1) else 0 end
  union all
  select 'family_joined'::text, v_family,
    case when v_signup > 0 then round((v_family::numeric / v_signup) * 100, 1) else 0 end,
    case when v_profile > 0 then round((v_family::numeric / v_profile) * 100, 1) else 0 end
  union all
  select 'child_added'::text, v_child,
    case when v_signup > 0 then round((v_child::numeric / v_signup) * 100, 1) else 0 end,
    case when v_family > 0 then round((v_child::numeric / v_family) * 100, 1) else 0 end
  union all
  select 'first_task_created'::text, v_task,
    case when v_signup > 0 then round((v_task::numeric / v_signup) * 100, 1) else 0 end,
    case when v_child > 0 then round((v_task::numeric / v_child) * 100, 1) else 0 end;
end;
$$;

revoke all on function public.get_admin_signup_funnel(integer) from public;
revoke all on function public.get_admin_signup_funnel(integer) from anon;
grant execute on function public.get_admin_signup_funnel(integer) to authenticated;

comment on function public.get_admin_signup_funnel(integer) is
  'Admin-only signup/onboarding funnel stage counts and conversion percentages. Verifies analytics_admins membership internally.';

-- ============================================================
-- 2. get_admin_recent_signups()
-- ============================================================

create or replace function public.get_admin_recent_signups(p_limit integer default 50)
returns table (
  signed_up_at timestamptz,
  email text,
  email_confirmed boolean,
  signed_in boolean,
  profile_created boolean,
  family_joined boolean,
  child_added boolean,
  task_created boolean
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

  if p_limit is null or p_limit <= 0 then
    p_limit := 50;
  end if;

  if p_limit > 200 then
    p_limit := 200;
  end if;

  return query
  select
    u.created_at as signed_up_at,
    u.email::text,
    (u.email_confirmed_at is not null) as email_confirmed,
    (u.last_sign_in_at is not null) as signed_in,
    exists (select 1 from public.profiles p where p.id = u.id) as profile_created,
    exists (select 1 from public.family_members fm where fm.user_id = u.id) as family_joined,
    exists (
      select 1
      from public.family_members fm
      join public.family_members fm2 on fm2.family_id = fm.family_id
      where fm.user_id = u.id
        and fm2.role = 'child'
    ) as child_added,
    exists (
      select 1
      from public.family_members fm
      join public.tasks t on t.family_id = fm.family_id
      where fm.user_id = u.id
    ) as task_created
  from auth.users u
  where nullif(trim(u.raw_user_meta_data ->> 'onboarding_full_name'), '') is not null
    and nullif(trim(u.raw_user_meta_data ->> 'onboarding_family_name'), '') is not null
  order by u.created_at desc
  limit p_limit;
end;
$$;

revoke all on function public.get_admin_recent_signups(integer) from public;
revoke all on function public.get_admin_recent_signups(integer) from anon;
grant execute on function public.get_admin_recent_signups(integer) to authenticated;

comment on function public.get_admin_recent_signups(integer) is
  'Admin-only recent signup diagnostic rows (derived booleans only, no passwords/tokens/identities). Verifies analytics_admins membership internally.';
