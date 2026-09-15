-- ============================================================
-- 023_fix_parent_onboarding_uuid.sql
-- ============================================================
-- Production hotfix persisted in migration form: the UUID-safe family lookup
-- previously used in production is applied here to avoid max(uuid) errors while
-- preserving the original onboarding logic and idempotent behavior.

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

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if exists (
    select 1
    from public.profiles pr
    where pr.id = v_user_id
      and pr.role = 'child'
  ) then
    raise exception 'existing child profile cannot be converted to parent through onboarding';
  end if;

  select count(*), max(fm.family_id::text)::uuid
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
