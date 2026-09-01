-- Additive migration: secure storage for Web Push device subscriptions.
--
-- This migration is BACKEND STORAGE ONLY. It does not send push notifications,
-- does not touch existing tables/triggers/RLS, and contains no VAPID keys or
-- other secrets. A later phase will add the Edge Function push sender and
-- VAPID configuration.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 1 and 2048),
  constraint push_subscriptions_p256dh_length check (char_length(p256dh) between 1 and 512),
  constraint push_subscriptions_auth_length check (char_length(auth) between 1 and 512)
);

-- A single physical browser/service-worker endpoint can only ever belong to
-- one user at a time. Re-registration under a different account (e.g. after
-- logout/login on a shared device) is handled by reassigning the row inside
-- the register_push_subscription RPC below, not by allowing duplicate rows.
create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

drop trigger if exists push_subscriptions_set_updated_at
on public.push_subscriptions;

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row
execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

-- Least privilege: users may only ever see their own device subscriptions.
-- No direct INSERT/UPDATE policy is provided; registration and reassignment
-- must go through the SECURITY DEFINER RPC below so a client can never set
-- user_id to anyone other than themselves.
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
on public.push_subscriptions
for select
using (user_id = auth.uid());

-- Deletion is also restricted to the owning user only, matching the
-- unregister RPC's guarantee. Kept as a policy (rather than RPC-only) so a
-- client can defensively call a direct delete if ever needed, without being
-- able to affect another user's rows.
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
on public.push_subscriptions
for delete
using (user_id = auth.uid());

-- No insert/update policy is created intentionally: all writes must go
-- through register_push_subscription, which derives user_id solely from
-- auth.uid() and can never be spoofed by client-supplied input.

revoke all on public.push_subscriptions from public;
revoke all on public.push_subscriptions from anon;
revoke all on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns table (
  id uuid,
  endpoint text,
  created_at timestamptz,
  updated_at timestamptz
)
security definer
set search_path = ''
language plpgsql
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_row record;
begin
  if v_user_id is null then
    raise exception 'Authentication required to register a push subscription.';
  end if;

  if p_endpoint is null or length(trim(p_endpoint)) = 0 then
    raise exception 'A push endpoint is required.';
  end if;

  if p_p256dh is null or length(trim(p_p256dh)) = 0 then
    raise exception 'A p256dh key is required.';
  end if;

  if p_auth is null or length(trim(p_auth)) = 0 then
    raise exception 'An auth secret is required.';
  end if;

  if length(p_endpoint) > 2048 then
    raise exception 'The push endpoint is too long.';
  end if;

  if length(p_p256dh) > 512 or length(p_auth) > 512 then
    raise exception 'The push subscription keys are too long.';
  end if;

  -- Perform the insert/reassignment and its authorization check as a single
  -- atomic statement so no concurrent transaction can insert or update the
  -- same endpoint between a separate lookup and this write (TOCTOU race).
  --
  -- The ON CONFLICT ... WHERE clause only allows the conflicting row to be
  -- updated when either:
  --   B. it already belongs to the current user, or
  --   C. it belongs to another user but the stored p256dh/auth exactly
  --      match the newly supplied keys (legitimate account switch on the
  --      same physical browser/device).
  -- Any other case (different user, different keys) leaves the existing
  -- row untouched and the ON CONFLICT DO UPDATE ... WHERE condition is not
  -- satisfied, so no row is produced by this statement.
  insert into public.push_subscriptions as ps (user_id, endpoint, p256dh, auth, last_seen_at)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, now())
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      last_seen_at = now(),
      updated_at = now()
  where ps.user_id = v_user_id
     or (ps.p256dh = excluded.p256dh and ps.auth = excluded.auth)
  returning ps.id, ps.endpoint, ps.created_at, ps.updated_at
  into v_row;

  if v_row.id is null then
    -- Endpoint exists, belongs to another user, and the supplied keys do
    -- not match the stored keys: refuse without revealing the previous
    -- owner or stored key material.
    raise exception 'This push subscription cannot be registered.';
  end if;

  return query
  select v_row.id, v_row.endpoint, v_row.created_at, v_row.updated_at;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text) from public;
revoke all on function public.register_push_subscription(text, text, text) from anon;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;

create or replace function public.unregister_push_subscription(
  p_endpoint text
)
returns void
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required to unregister a push subscription.';
  end if;

  if p_endpoint is null or length(trim(p_endpoint)) = 0 then
    raise exception 'A push endpoint is required.';
  end if;

  delete from public.push_subscriptions
  where endpoint = p_endpoint
    and user_id = v_user_id;
end;
$$;

revoke all on function public.unregister_push_subscription(text) from public;
revoke all on function public.unregister_push_subscription(text) from anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;
