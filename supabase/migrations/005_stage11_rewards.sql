alter table public.user_rewards
  add column if not exists status public.completion_status not null default 'pending',
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists xp_cost_snapshot integer not null default 0 check (xp_cost_snapshot >= 0);

alter table public.user_rewards
  drop constraint if exists user_rewards_user_id_reward_id_key;

create unique index if not exists user_rewards_one_pending_per_user_reward
  on public.user_rewards (user_id, reward_id)
  where status = 'pending';

create or replace function public.ensure_user_reward_defaults()
returns trigger
language plpgsql
as $$
declare
  reward_row record;
begin
  select r.id, r.family_id, r.xp_cost
  into reward_row
  from public.rewards r
  where r.id = new.reward_id;

  if reward_row.id is null then
    raise exception 'reward must exist';
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.requested_at := coalesce(new.requested_at, now());
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.xp_cost_snapshot := reward_row.xp_cost;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'pending' then
      raise exception 'resolved reward redemptions cannot be modified';
    end if;

    new.user_id := old.user_id;
    new.reward_id := old.reward_id;
    new.requested_at := old.requested_at;
    new.xp_cost_snapshot := old.xp_cost_snapshot;

    if new.status = 'pending' then
      raise exception 'reward requests cannot be returned to pending';
    end if;

    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists user_rewards_set_defaults on public.user_rewards;
create trigger user_rewards_set_defaults
before insert or update on public.user_rewards
for each row
execute function public.ensure_user_reward_defaults();

drop policy if exists "user_rewards_insert_parent_only" on public.user_rewards;
create policy "user_rewards_insert_child_pending_only"
on public.user_rewards
for insert
with check (
  user_id = auth.uid()
  and status = 'pending'
  and exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_family_member(r.family_id)
      and not private.is_parent_member(r.family_id)
  )
);

drop policy if exists "user_rewards_update_parent_only" on public.user_rewards;
create policy "user_rewards_update_parent_only"
on public.user_rewards
for update
using (
  exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_parent_member(r.family_id)
  )
)
with check (
  status in ('approved', 'rejected')
  and reviewed_by is not null
  and reviewed_at is not null
  and exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_parent_member(r.family_id)
  )
);
