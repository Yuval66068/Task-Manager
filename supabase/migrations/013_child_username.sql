-- Phase 2A (part B): child login username database foundation.
--
-- Adds a per-family child login handle (child_username), used later
-- alongside family_code + a 6-digit PIN for child login. This migration
-- only adds the column, its constraints, and a scoped case-insensitive
-- uniqueness index. It intentionally does NOT add any PIN/password/
-- synthetic-email/login-token column, and does NOT change any RLS policy
-- or grant.
--
-- Purely additive: no existing columns/constraints/policies are modified.

-- ==================================================================
-- 1. Column
-- ==================================================================

alter table public.family_members
  add column if not exists child_username text;

-- ==================================================================
-- 2. Basic shape constraints
-- ==================================================================
-- - max 30 characters
-- - if non-null, must not be empty after trimming
-- (Trimming/whitespace normalization on write is the responsibility of the
-- future secure server-side child-management code path; this migration
-- only guards against storing an empty/oversized value.)

alter table public.family_members
  add constraint family_members_child_username_length
  check (
    child_username is null
    or (
      length(child_username) <= 30
      and length(trim(both from child_username)) > 0
    )
  );

-- ==================================================================
-- 3. Role constraint: only role='child' rows may have a non-null
--    child_username. Parent rows must never have one.
-- ==================================================================

alter table public.family_members
  add constraint family_members_child_username_role
  check (
    child_username is null
    or role = 'child'
  );

-- ==================================================================
-- 4. Uniqueness: case-insensitive, scoped per family, only for non-null
--    usernames. Existing NULL usernames (all current rows) are entirely
--    unaffected -- partial unique indexes ignore NULLs and rows that don't
--    match the WHERE clause.
-- ==================================================================

create unique index if not exists family_members_child_username_unique_per_family
  on public.family_members (family_id, lower(trim(both from child_username)))
  where role = 'child' and child_username is not null;

-- ==================================================================
-- 5. Normalization trigger: trim child_username before it is checked by
--    the CHECK constraints / unique index above. This guarantees the
--    stored value (and the value the CHECK constraints validate) is never
--    surrounded by whitespace, without requiring every caller to remember
--    to trim it themselves. Display casing is intentionally preserved --
--    only surrounding whitespace is stripped here; case-insensitivity is
--    handled separately by the unique index expression above.
--
-- The trigger touches ONLY child_username and leaves every other column
-- of NEW untouched.
-- ==================================================================

create or replace function private.normalize_child_username()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  if new.child_username is not null then
    new.child_username := btrim(new.child_username);
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_child_username() from public;

drop trigger if exists normalize_child_username on public.family_members;

create trigger normalize_child_username
  before insert or update on public.family_members
  for each row
  execute function private.normalize_child_username();

-- ==================================================================
-- 6. No RLS changes.
-- ==================================================================
-- family_members_insert_blocked / family_members_update_blocked /
-- family_members_delete_blocked remain exactly as defined in
-- 002_rls_policies.sql. Parents still cannot directly UPDATE family_members
-- rows (including to set a username) through client-side RLS. Setting
-- child_username will happen later through a secure, server-side,
-- SECURITY DEFINER child-management code path (not implemented here), the
-- same pattern already used by private.add_child_member.
--
-- No new anonymous access is introduced. family_members_select_same_family
-- (unchanged) continues to scope visibility to members of the same family,
-- so one family's child_username values are never exposed to another
-- family.
