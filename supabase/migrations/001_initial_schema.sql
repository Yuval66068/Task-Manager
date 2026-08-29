create extension if not exists pgcrypto;

create schema if not exists private;

create type public.user_role as enum ('parent', 'child');
create type public.task_status as enum ('pending', 'in_progress', 'completed', 'approved', 'rejected', 'overdue');
create type public.completion_status as enum ('pending', 'submitted', 'approved', 'rejected');
create type public.notification_type as enum (
  'task_assigned',
  'task_completed',
  'task_approved',
  'task_rejected',
  'reward_redeemed',
  'family_invite'
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.user_role not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.user_role not null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null,
  description text,
  emoji text not null default '✅',
  xp integer not null default 10 check (xp >= 0),
  assigned_to uuid not null references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  status public.task_status not null default 'pending',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  child_id uuid not null references public.profiles (id) on delete cascade,
  status public.completion_status not null default 'pending',
  completion_note text,
  proof_photo_url text,
  submitted_at timestamptz default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, child_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type public.notification_type not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  code text not null unique,
  title text not null,
  description text,
  xp_reward integer not null default 0 check (xp_reward >= 0),
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null,
  description text,
  xp_cost integer not null default 0 check (xp_cost >= 0),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);

create table if not exists public.user_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id uuid not null references public.rewards (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  redeemed_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reward_id)
);

-- family_members.role is the only authoritative source for family-scoped authorization.
-- profiles.role is metadata only and must not be used to authorize access to family data.
-- All family-scoped permission checks must evaluate membership and role via family_members.

create or replace function public.ensure_family_owner_is_parent_member()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = new.id
      and fm.user_id = new.owner_id
      and fm.role = 'parent'
  ) then
    raise exception 'families.owner_id must reference a parent member of the same family';
  end if;

  return new;
end;
$$;

create constraint trigger families_owner_must_be_parent_member
after insert or update of owner_id on public.families
deferrable initially deferred
for each row
execute function public.ensure_family_owner_is_parent_member();

create or replace function public.ensure_task_assignment_is_valid()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = new.family_id
      and fm.user_id = new.assigned_to
  ) then
    raise exception 'tasks.assigned_to must be a member of the same family';
  end if;

  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = new.family_id
      and fm.user_id = new.assigned_to
      and fm.role = 'child'
  ) then
    raise exception 'tasks.assigned_to must be a child member of the family';
  end if;

  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = new.family_id
      and fm.user_id = new.created_by
  ) then
    raise exception 'tasks.created_by must belong to the same family';
  end if;

  return new;
end;
$$;

create constraint trigger tasks_assignment_must_match_family
after insert or update of family_id, assigned_to, created_by on public.tasks
deferrable initially deferred
for each row
execute function public.ensure_task_assignment_is_valid();

create or replace function public.ensure_task_completion_matches_assigned_child()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.tasks t
    join public.family_members fm
      on fm.family_id = t.family_id
     and fm.user_id = new.child_id
     and fm.role = 'child'
    where t.id = new.task_id
      and t.assigned_to = new.child_id
  ) then
    raise exception 'task_completions.child_id must match the assigned child for that task';
  end if;

  return new;
end;
$$;

create constraint trigger task_completion_matches_assigned_child
after insert or update of task_id, child_id on public.task_completions
deferrable initially deferred
for each row
execute function public.ensure_task_completion_matches_assigned_child();

create or replace function private.user_family_memberships()
returns table (family_id uuid, member_role public.user_role)
security definer
set search_path = ''
language sql
stable
as $$
  select fm.family_id, fm.role as member_role
  from public.family_members fm
  where fm.user_id = auth.uid();
$$;

create or replace function private.is_family_member(p_family_id uuid)
returns boolean
security definer
set search_path = ''
language sql
stable
as $$
  select exists (
    select 1
    from private.user_family_memberships() ufm
    where ufm.family_id = p_family_id
  );
$$;

create or replace function private.is_parent_member(p_family_id uuid)
returns boolean
security definer
set search_path = ''
language sql
stable
as $$
  select exists (
    select 1
    from private.user_family_memberships() ufm
    where ufm.family_id = p_family_id
      and ufm.member_role = 'parent'
  );
$$;

create or replace function private.create_family_with_owner(p_name text)
returns uuid
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  insert into public.families (name, owner_id)
  values (p_name, v_user_id)
  returning id into v_family_id;

  insert into public.family_members (family_id, user_id, role)
  values (v_family_id, v_user_id, 'parent');

  return v_family_id;
end;
$$;

create or replace function private.add_child_member(p_family_id uuid, p_user_id uuid)
returns uuid
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_current_user uuid := auth.uid();
  v_member_id uuid;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;

  if not private.is_parent_member(p_family_id) then
    raise exception 'only parents can add family members';
  end if;

  if p_user_id = v_current_user then
    raise exception 'user cannot add themselves as a member through this helper';
  end if;

  insert into public.family_members (family_id, user_id, role)
  values (p_family_id, p_user_id, 'child')
  returning id into v_member_id;

  return v_member_id;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.user_family_memberships() from public;
grant execute on function private.user_family_memberships() to authenticated;
revoke all on function private.is_family_member(uuid) from public;
grant execute on function private.is_family_member(uuid) to authenticated;
revoke all on function private.is_parent_member(uuid) from public;
grant execute on function private.is_parent_member(uuid) to authenticated;
revoke all on function private.create_family_with_owner(text) from public;
grant execute on function private.create_family_with_owner(text) to authenticated;
revoke all on function private.add_child_member(uuid, uuid) from public;
grant execute on function private.add_child_member(uuid, uuid) to authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger families_set_updated_at
before update on public.families
for each row
execute function public.set_updated_at();

create trigger family_members_set_updated_at
before update on public.family_members
for each row
execute function public.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

create trigger task_completions_set_updated_at
before update on public.task_completions
for each row
execute function public.set_updated_at();

create trigger notifications_set_updated_at
before update on public.notifications
for each row
execute function public.set_updated_at();

create trigger achievements_set_updated_at
before update on public.achievements
for each row
execute function public.set_updated_at();

create trigger rewards_set_updated_at
before update on public.rewards
for each row
execute function public.set_updated_at();

create trigger user_achievements_set_updated_at
before update on public.user_achievements
for each row
execute function public.set_updated_at();

create trigger user_rewards_set_updated_at
before update on public.user_rewards
for each row
execute function public.set_updated_at();

create index if not exists idx_profiles_email on public.profiles (email);
create index if not exists idx_family_members_family_id on public.family_members (family_id);
create index if not exists idx_family_members_user_id on public.family_members (user_id);
create index if not exists idx_tasks_family_id on public.tasks (family_id);
create index if not exists idx_tasks_assigned_to on public.tasks (assigned_to);
create index if not exists idx_tasks_created_by on public.tasks (created_by);
create index if not exists idx_task_completions_task_id on public.task_completions (task_id);
create index if not exists idx_task_completions_child_id on public.task_completions (child_id);
create index if not exists idx_task_completions_status on public.task_completions (status);
create index if not exists idx_notifications_recipient_id on public.notifications (recipient_id);
create index if not exists idx_notifications_family_id on public.notifications (family_id);
create index if not exists idx_achievements_family_id on public.achievements (family_id);
create index if not exists idx_rewards_family_id on public.rewards (family_id);
create index if not exists idx_rewards_active on public.rewards (family_id, is_active);
create index if not exists idx_user_achievements_user_id on public.user_achievements (user_id);
create index if not exists idx_user_rewards_user_id on public.user_rewards (user_id);
