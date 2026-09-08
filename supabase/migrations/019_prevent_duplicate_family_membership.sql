-- Stage: prevent duplicate family creation / multi-family membership.
--
-- This migration is strictly additive on top of 018_admin_analytics.sql. It
-- does not remove or weaken any existing constraint. It adds:
--
--   1. A safety preflight check confirming no user_id currently belongs to
--      more than one distinct family_id, followed by a UNIQUE index on
--      public.family_members(user_id) enforcing the "one family per user"
--      product invariant for parents, invited second parents, and children.
--   2. A race-safe, idempotent replacement of public.onboard_parent_family
--      that serializes concurrent onboarding attempts for the same user via
--      a transaction-scoped advisory lock, and returns the existing family
--      as a successful idempotent result instead of creating a duplicate.
--
-- Existing duplicate data has already been manually cleaned up before this
-- migration is applied.

-- ============================================================
-- 1. Preflight invariant check + unique index
-- ============================================================

do $$
declare
  v_offending_user_id uuid;
  v_family_count bigint;
begin
  select fm.user_id, count(distinct fm.family_id)
    into v_offending_user_id, v_family_count
  from public.family_members fm
  group by fm.user_id
  having count(distinct fm.family_id) > 1
  limit 1;

  if v_offending_user_id is not null then
    raise exception
      'Cannot enforce one-family-per-user invariant: user_id % already belongs to % distinct families. Resolve duplicate family_members rows before applying this migration.',
      v_offending_user_id, v_family_count;
  end if;
end;
$$;

-- The existing (family_id, user_id) unique constraint from 001_initial_schema
-- is left completely untouched. This new index adds a stricter, global
-- invariant: a given user_id may appear in at most one family_members row at
-- all, across any family. This protects parent onboarding, second-parent
-- invite acceptance, child creation, and any future membership flow from
-- ever creating a second membership for the same user.
create unique index if not exists family_members_one_family_per_user_uidx
  on public.family_members (user_id);

comment on index public.family_members_one_family_per_user_uidx is
  'Enforces the product invariant that one auth user belongs to at most one family. Do not drop without also removing multi-family support intentionally.';

-- ============================================================
-- 2. Race-safe, idempotent onboard_parent_family
-- ============================================================
--
-- Behavior preserved exactly from 008_parent_self_service_onboarding.sql:
--   - same signature: (p_full_name text, p_family_name text)
--   - same return columns/types: (user_id uuid, family_id uuid, role text,
--     family_name text)
--   - same validation (trimmed full_name/family_name required, length caps)
--   - same profile insert/update-on-conflict behavior
--   - same use of auth.uid() as the sole source of user identity
--   - same delegation to private.create_family_with_owner(...) for the
--     actual new-family creation
--   - same "existing child profile cannot be converted to parent" guard
--
-- New behavior added:
--   - a transaction-scoped pg_advisory_xact_lock keyed on the authenticated
--     user's UUID serializes concurrent/duplicate onboarding calls for the
--     same user, so two near-simultaneous calls cannot both pass the
--     "no existing membership" check and both create a family.
--   - after acquiring the lock, membership is re-checked. If the user
--     already has exactly one PARENT membership, onboarding is treated as
--     already complete and the existing family/user/role/family_name is
--     returned as a successful idempotent result (no second family created).
--   - if the user already has a CHILD membership, the existing "user already
--     belongs to a family" exception is raised (unchanged from before).
--   - if, despite the unique index, more than one membership is somehow
--     found, a clear exception is raised rather than silently picking one.

create or replace function public.onboard_parent_family(
  p_full_name text,
  p_family_name text
)
returns table (
  user_id uuid,
  family_id uuid,
  role text,
  family_name text
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_family_id uuid;
  v_trimmed_full_name text;
  v_trimmed_family_name text;
  v_existing_membership_count bigint;
  v_existing_family_id uuid;
  v_existing_role public.user_role;
  v_existing_family_name text;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  v_trimmed_full_name := trim(coalesce(p_full_name, ''));
  v_trimmed_family_name := trim(coalesce(p_family_name, ''));

  if v_trimmed_full_name = '' then
    raise exception 'full_name is required';
  end if;

  if v_trimmed_family_name = '' then
    raise exception 'family_name is required';
  end if;

  if char_length(v_trimmed_full_name) > 100 then
    raise exception 'full_name is too long';
  end if;

  if char_length(v_trimmed_family_name) > 100 then
    raise exception 'family_name is too long';
  end if;

  -- Serialize all onboarding attempts for this specific user within this
  -- transaction. hashtextextended gives a stable 64-bit key derived from the
  -- user's UUID text representation; the lock is automatically released at
  -- transaction end (commit or rollback), so no explicit unlock is needed.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if exists (
    select 1
    from public.profiles pr
    where pr.id = v_user_id
      and pr.role = 'child'
  ) then
    raise exception 'existing child profile cannot be converted to parent through onboarding';
  end if;

  -- Re-check membership after acquiring the lock: a concurrent call that
  -- started just before this one may have already created the family while
  -- we were waiting for the lock.
  select count(*), max(fm.family_id)
    into v_existing_membership_count, v_existing_family_id
  from public.family_members fm
  where fm.user_id = v_user_id;

  if v_existing_membership_count > 1 then
    raise exception 'data integrity error: user % has more than one family membership', v_user_id;
  end if;

  if v_existing_membership_count = 1 then
    select fm.role
      into v_existing_role
    from public.family_members fm
    where fm.user_id = v_user_id
      and fm.family_id = v_existing_family_id;

    if v_existing_role = 'child' then
      raise exception 'user already belongs to a family';
    end if;

    -- Existing PARENT membership: treat as an idempotent success and return
    -- the existing family instead of creating a duplicate.
    select f.name
      into v_existing_family_name
    from public.families f
    where f.id = v_existing_family_id;

    return query
    select
      v_user_id as user_id,
      v_existing_family_id as family_id,
      'parent'::text as role,
      v_existing_family_name as family_name;
    return;
  end if;

  select au.email
    into v_email
  from auth.users au
  where au.id = v_user_id;

  if v_email is null or trim(v_email) = '' then
    raise exception 'authenticated user has no email';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (v_user_id, v_email, v_trimmed_full_name, 'parent')
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = 'parent',
        updated_at = now();

  v_family_id := private.create_family_with_owner(v_trimmed_family_name);

  return query
  select
    v_user_id as user_id,
    v_family_id as family_id,
    'parent'::text as role,
    v_trimmed_family_name as family_name;
end;
$$;

revoke all on function public.onboard_parent_family(text, text) from public;
revoke all on function public.onboard_parent_family(text, text) from anon;
grant execute on function public.onboard_parent_family(text, text) to authenticated;

comment on function public.onboard_parent_family(text, text) is
  'Create a parent profile and a new family for the authenticated user in one atomic, race-safe onboarding step. Serializes concurrent calls per-user via a transaction-scoped advisory lock and returns the existing family idempotently if one already exists. The function derives the current user from auth.uid() and never trusts client-provided owner_id or role values.';
