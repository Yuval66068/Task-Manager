-- Phase 2B (revised): server/admin-only finalization RPC for create-child.
--
-- Supersedes the original 014 design (a `public.create_child_member_with_username`
-- wrapper granted to `authenticated`). That design was an unnecessary
-- authenticated attack surface: it accepted an arbitrary child user id from
-- any authenticated caller's own RPC call. This revision replaces it with a
-- single service_role-only RPC that performs all POST-AUTH database work
-- (profile + family_members insert) after independently re-verifying the
-- parent/family relationship itself.
--
-- private.add_child_member(family_id, user_id) (001_initial_schema.sql)
-- remains completely untouched.
--
-- Purely additive: no existing function/table/policy is modified.

-- ==================================================================
-- private.is_parent_member is reused as-is (001_initial_schema.sql) to
-- independently verify parent membership in other RPCs, but it internally
-- checks private.user_family_memberships(), which is itself derived from
-- auth.uid(). This RPC is invoked by service_role (not the parent's own
-- session), so auth.uid() would be null there. Instead, the relationship
-- is verified directly against public.family_members using the supplied
-- p_parent_user_id.
-- ==================================================================

create or replace function public.finalize_created_child(
  p_parent_user_id uuid,
  p_family_id uuid,
  p_child_user_id uuid,
  p_child_email text,
  p_child_full_name text,
  p_child_username text
)
returns table (
  id uuid,
  full_name text,
  child_username text
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_is_parent boolean;
  v_full_name text;
  v_username text;
begin
  if p_parent_user_id is null or p_family_id is null or p_child_user_id is null then
    raise exception 'parent_user_id, family_id and child_user_id are required';
  end if;

  -- Independently re-verify the parent/family relationship. This RPC is
  -- callable only by service_role (see grants below), but it must never
  -- trust the caller's (the Edge Function's) own prior authorization
  -- check -- it re-derives authorization from the database itself.
  select exists (
    select 1
    from public.family_members fm
    where fm.user_id = p_parent_user_id
      and fm.family_id = p_family_id
      and fm.role = 'parent'
  ) into v_is_parent;

  if not v_is_parent then
    raise exception 'supplied parent_user_id is not a parent member of family_id';
  end if;

  v_full_name := trim(coalesce(p_child_full_name, ''));
  if v_full_name = '' then
    raise exception 'child full_name is required';
  end if;
  if char_length(v_full_name) > 100 then
    raise exception 'child full_name is too long';
  end if;

  v_username := trim(coalesce(p_child_username, ''));
  if v_username = '' then
    raise exception 'child_username is required';
  end if;
  if char_length(v_username) > 30 then
    raise exception 'child_username is too long';
  end if;

  if p_child_email is null or trim(p_child_email) = '' then
    raise exception 'child email is required';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (p_child_user_id, p_child_email, v_full_name, 'child');

  -- The final username-uniqueness authority is the partial unique index
  -- from 013_child_username.sql (family_members_child_username_unique_per_family).
  -- A race that slips past any Edge Function pre-check surfaces here as a
  -- unique_violation (SQLSTATE 23505), which the caller maps to a generic,
  -- user-safe message using the returned constraint name -- not by
  -- pattern-matching error text.
  insert into public.family_members (family_id, user_id, role, child_username)
  values (p_family_id, p_child_user_id, 'child', v_username);

  return query
  select p_child_user_id as id, v_full_name as full_name, v_username as child_username;
end;
$$;

-- Explicit, minimal privileges: only service_role may ever call this.
-- Neither anon, authenticated, nor the implicit PUBLIC role can invoke it.
-- The Edge Function must call it exclusively through ctx.supabaseAdmin
-- (service role), never through ctx.supabase (RLS/anon/authenticated
-- context).
revoke all on function public.finalize_created_child(uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.finalize_created_child(uuid, uuid, uuid, text, text, text) from anon;
revoke all on function public.finalize_created_child(uuid, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.finalize_created_child(uuid, uuid, uuid, text, text, text) to service_role;

comment on function public.finalize_created_child(uuid, uuid, uuid, text, text, text) is
  'Service-role-only finalization step for child account creation: independently re-verifies that parent_user_id is a parent member of family_id, then inserts the child profile and family_members rows. Callable only via ctx.supabaseAdmin from the create-child Edge Function -- never exposed to anon/authenticated clients.';
