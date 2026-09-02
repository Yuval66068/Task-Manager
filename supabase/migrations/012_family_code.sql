-- Phase 1: family_code database foundation.
--
-- Adds a human-friendly, immutable locator code to public.families, used
-- later for child PIN login (family_code + child_username + PIN). The code
-- is NOT a secret/password -- it is only a locator -- but it must still be
-- unguessable-by-construction-independent (not derived from the family's
-- UUID) and must never be settable by a client.
--
-- This migration is purely additive: no existing columns/constraints are
-- modified, and no existing RLS policy is dropped.

-- ==================================================================
-- 1. Column
-- ==================================================================

alter table public.families
  add column if not exists family_code text;

-- ==================================================================
-- 2. Generator (private schema, not directly callable by clients)
-- ==================================================================
-- Alphabet excludes visually ambiguous characters: 0/O and 1/I are removed.
-- Uses Postgres' built-in random() (no pgcrypto/pgsodium dependency) so this
-- migration has zero extension requirements. random() is sufficient here
-- because family_code is an identifier/locator, not a secret -- see report.

create or replace function private.generate_family_code()
returns text
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_alphabet_len int := length(v_alphabet);
  v_code text;
  v_attempt int := 0;
  v_max_attempts constant int := 25;
  v_exists boolean;
begin
  loop
    v_attempt := v_attempt + 1;

    if v_attempt > v_max_attempts then
      raise exception 'private.generate_family_code: exceeded % attempts generating a unique family code', v_max_attempts;
    end if;

    select string_agg(
             substr(v_alphabet, (floor(random() * v_alphabet_len))::int + 1, 1),
             ''
           )
    into v_code
    from generate_series(1, 6);

    select exists (
      select 1 from public.families f where f.family_code = v_code
    ) into v_exists;

    exit when not v_exists;
  end loop;

  return v_code;
end;
$$;

-- No execute grant to anon/authenticated: this helper is only ever invoked
-- from other SECURITY DEFINER functions (backfill below, and the family
-- creation path) running as the migration/database owner or via existing
-- SECURITY DEFINER RPCs that already have the privileges they need.
revoke all on function private.generate_family_code() from public;

-- ==================================================================
-- 3. Backfill existing families
-- ==================================================================

do $$
declare
  v_family record;
begin
  for v_family in
    select id from public.families where family_code is null
  loop
    update public.families
    set family_code = private.generate_family_code()
    where id = v_family.id;
  end loop;
end;
$$;

-- ==================================================================
-- 4. Constraints: NOT NULL + UNIQUE
-- ==================================================================

alter table public.families
  alter column family_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'families_family_code_key'
  ) then
    alter table public.families
      add constraint families_family_code_key unique (family_code);
  end if;
end;
$$;

-- ==================================================================
-- 5. Default generation for future inserts (defense in depth)
-- ==================================================================
-- private.create_family_with_owner already only ever inserts (name,
-- owner_id) and lets Postgres fill everything else, so a column default is
-- sufficient to guarantee every future family automatically receives a code
-- without requiring any change to the insert statement or the frontend.

alter table public.families
  alter column family_code set default private.generate_family_code();

-- ==================================================================
-- 6. Immutability: prevent family_code from being changed via the existing
--    families_update_parents_only RLS policy (which allows parents to
--    update their family row, e.g. to rename it).
-- ==================================================================
-- Rather than weakening/rewriting the existing UPDATE policy (which would
-- risk breaking the family-name-rename behavior it also protects), install
-- a BEFORE UPDATE trigger. Unlike a silent overwrite, this version FAILS
-- EXPLICITLY when a caller actually attempts to change family_code, so any
-- application bug that tries to mutate it is surfaced immediately instead
-- of being silently discarded. Updates that leave family_code unchanged
-- (e.g. renaming the family) proceed normally.

create or replace function private.protect_family_code()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  if new.family_code is distinct from old.family_code then
    raise exception 'Family code cannot be changed.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_family_code() from public;

drop trigger if exists protect_family_code on public.families;

create trigger protect_family_code
  before update on public.families
  for each row
  execute function private.protect_family_code();

-- ==================================================================
-- 8. Make future family creation resilient to a UNIQUE family_code
--    collision under concurrent creation.
-- ==================================================================
-- private.create_family_with_owner relies on the family_code column
-- default (private.generate_family_code()) to populate family_code on
-- insert. That generator already checks for collisions before returning a
-- candidate, but two concurrent transactions could each pass that check
-- for the same code before either commits, causing one INSERT to fail with
-- a unique_violation on families_family_code_key.
--
-- This redefinition keeps the exact same signature, return type,
-- authorization behavior (auth.uid() required), and owner/member creation
-- behavior as the original in 001_initial_schema.sql. The only change is
-- that the families insert is wrapped in a bounded retry loop that catches
-- unique_violation specifically on family_code and retries with a freshly
-- generated code, instead of leaking the low-probability race up to the
-- caller as a hard failure.

create or replace function private.create_family_with_owner(p_name text)
returns uuid
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
  v_attempt int := 0;
  v_max_attempts constant int := 5;
  v_constraint_name text;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  loop
    v_attempt := v_attempt + 1;

    begin
      insert into public.families (name, owner_id)
      values (p_name, v_user_id)
      returning id into v_family_id;

      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;

        if v_constraint_name is distinct from 'families_family_code_key' then
          raise;
        end if;

        if v_attempt >= v_max_attempts then
          raise exception 'private.create_family_with_owner: exceeded % attempts due to family_code collisions', v_max_attempts;
        end if;
        -- retry: the column default will generate a fresh
        -- private.generate_family_code() candidate on the next attempt.
    end;
  end loop;

  insert into public.family_members (family_id, user_id, role)
  values (v_family_id, v_user_id, 'parent');

  return v_family_id;
end;
$$;

revoke all on function private.create_family_with_owner(text) from public;
grant execute on function private.create_family_with_owner(text) to authenticated;

