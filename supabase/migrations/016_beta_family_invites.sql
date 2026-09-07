create type public.family_invite_status as enum ('pending', 'accepted', 'expired');

create table public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_email text not null,
  invite_token uuid not null unique default gen_random_uuid(),
  status public.family_invite_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint family_invites_invitee_email_not_blank
    check (length(trim(invitee_email)) > 0),

  constraint family_invites_expires_after_created
    check (expires_at > created_at)
);

create unique index family_invites_active_invite_unique_idx
  on public.family_invites (family_id, lower(invitee_email))
  where status = 'pending';

create index family_invites_pending_lookup_idx
  on public.family_invites (
    invite_token,
    status,
    expires_at,
    created_at desc
  );

alter table public.family_invites enable row level security;

revoke all on table public.family_invites from public;
revoke all on table public.family_invites from anon;
revoke all on table public.family_invites from authenticated;

grant all on table public.family_invites to service_role;


create or replace function public.create_family_invite(
  p_family_id uuid,
  p_inviter_id uuid,
  p_invitee_email text
)
returns table (
  id uuid,
  invite_token uuid,
  invitee_email text,
  status public.family_invite_status,
  expires_at timestamptz
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_is_parent boolean;
  v_email text;
begin
  if p_family_id is null or p_inviter_id is null then
    raise exception 'family_id and inviter_id are required';
  end if;

  v_email := lower(trim(coalesce(p_invitee_email, '')));

  if v_email = '' then
    raise exception 'invitee email is required';
  end if;

  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = p_inviter_id
      and fm.role = 'parent'
  )
  into v_is_parent;

  if not v_is_parent then
    raise exception 'inviter must be a parent member of the target family';
  end if;

  -- Replace any previous unused invite for this family/email.
  update public.family_invites
  set
    status = 'expired',
    updated_at = now()
  where family_id = p_family_id
    and lower(invitee_email) = v_email
    and status = 'pending';

  return query
  insert into public.family_invites (
    family_id,
    inviter_id,
    invitee_email,
    status,
    expires_at
  )
  values (
    p_family_id,
    p_inviter_id,
    v_email,
    'pending',
    now() + interval '7 days'
  )
  returning
    family_invites.id,
    family_invites.invite_token,
    family_invites.invitee_email,
    family_invites.status,
    family_invites.expires_at;

exception
  when unique_violation then
    raise exception 'an active invite already exists for this email';
end;
$$;

revoke all on function public.create_family_invite(uuid, uuid, text) from public;
revoke all on function public.create_family_invite(uuid, uuid, text) from anon;
revoke all on function public.create_family_invite(uuid, uuid, text) from authenticated;

grant execute
on function public.create_family_invite(uuid, uuid, text)
to service_role;


create or replace function public.accept_family_invite(
  p_invite_token uuid,
  p_accepting_user_id uuid
)
returns table (
  family_id uuid,
  invitee_email text,
  accepted_at timestamptz
)
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_invite record;
begin
  if p_invite_token is null or p_accepting_user_id is null then
    raise exception 'invite token and accepting user id are required';
  end if;

  select *
  into v_invite
  from public.family_invites fi
  where fi.invite_token = p_invite_token
    and fi.status = 'pending'
    and fi.expires_at > now()
  for update;

  if not found then
    raise exception 'invite not found, expired, or already accepted';
  end if;

  -- The authenticated user's email must match the invited email.
  if not exists (
    select 1
    from auth.users au
    where au.id = p_accepting_user_id
      and lower(au.email) = lower(v_invite.invitee_email)
  ) then
    raise exception 'invite is not for the current authenticated user';
  end if;

  -- A user may not join a second family.
  if exists (
    select 1
    from public.family_members fm
    where fm.user_id = p_accepting_user_id
      and fm.family_id <> v_invite.family_id
  ) then
    raise exception 'user already belongs to a different family';
  end if;

  -- Already in this family = idempotent success.
  if exists (
    select 1
    from public.family_members fm
    where fm.user_id = p_accepting_user_id
      and fm.family_id = v_invite.family_id
  ) then
    update public.family_invites
    set
      status = 'accepted',
      accepted_by = p_accepting_user_id,
      accepted_at = now(),
      updated_at = now()
    where id = v_invite.id;

    return query
    select
      v_invite.family_id,
      v_invite.invitee_email,
      now();

    return;
  end if;

  insert into public.family_members (
    family_id,
    user_id,
    role
  )
  values (
    v_invite.family_id,
    p_accepting_user_id,
    'parent'
  );

  update public.family_invites
  set
    status = 'accepted',
    accepted_by = p_accepting_user_id,
    accepted_at = now(),
    updated_at = now()
  where id = v_invite.id;

  return query
  select
    v_invite.family_id,
    v_invite.invitee_email,
    now();
end;
$$;

revoke all on function public.accept_family_invite(uuid, uuid) from public;
revoke all on function public.accept_family_invite(uuid, uuid) from anon;
revoke all on function public.accept_family_invite(uuid, uuid) from authenticated;

grant execute
on function public.accept_family_invite(uuid, uuid)
to service_role;


comment on table public.family_invites is
  'Pending second-parent family invitations. Invitee email is matched against the authenticated user email when the invite is accepted.';

comment on function public.create_family_invite(uuid, uuid, text) is
  'Service-role helper for issuing a parent-to-parent family invite.';

comment on function public.accept_family_invite(uuid, uuid) is
  'Service-role helper for accepting a family invite into the same family as the inviter.';