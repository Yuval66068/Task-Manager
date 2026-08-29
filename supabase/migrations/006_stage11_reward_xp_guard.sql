create or replace function private.calculate_rewardable_xp(p_user_id uuid, p_family_id uuid)
returns integer
security definer
set search_path = ''
language plpgsql
as $$
declare
  base_xp integer := 0;
  approved_count integer := 0;
  streak integer := 0;
  daily_bonus_days integer := 0;
  achievement_xp integer := 0;
  reward_xp_spent integer := 0;
  required_daily_count integer := 0;
  latest_approved_date date;
  current_date_key date;
  approved_dates date[] := '{}'::date[];
begin
  select coalesce(sum(t.xp), 0), count(*)
  into base_xp, approved_count
  from public.tasks t
  where t.family_id = p_family_id
    and t.assigned_to = p_user_id
    and t.status in ('approved', 'completed');

  select coalesce(array_agg(distinct approved_date order by approved_date), '{}'::date[])
  into approved_dates
  from (
    select distinct (coalesce(tc.reviewed_at, tc.submitted_at))::date as approved_date
    from public.tasks t
    join public.task_completions tc
      on tc.task_id = t.id
     and tc.child_id = p_user_id
     and tc.status = 'approved'
    where t.family_id = p_family_id
      and t.assigned_to = p_user_id
      and t.status in ('approved', 'completed')
      and coalesce(tc.reviewed_at, tc.submitted_at) is not null
  ) approved_task_dates;

  if array_length(approved_dates, 1) is not null then
    latest_approved_date := approved_dates[array_length(approved_dates, 1)];
    current_date_key := latest_approved_date;

    while current_date_key = any(approved_dates) loop
      streak := streak + 1;
      current_date_key := current_date_key - 1;
    end loop;
  end if;

  select count(*)
  into required_daily_count
  from public.tasks t
  where t.family_id = p_family_id
    and t.assigned_to = p_user_id
    and t.recurrence = 'daily';

  if required_daily_count > 0 then
    select count(*)
    into daily_bonus_days
    from (
      select (coalesce(tc.reviewed_at, tc.submitted_at))::date as approved_date
      from public.tasks t
      join public.task_completions tc
        on tc.task_id = t.id
       and tc.child_id = p_user_id
       and tc.status = 'approved'
      where t.family_id = p_family_id
        and t.assigned_to = p_user_id
        and t.recurrence = 'daily'
        and t.status in ('approved', 'completed')
        and coalesce(tc.reviewed_at, tc.submitted_at) is not null
      group by approved_date
      having count(distinct t.id) = required_daily_count
    ) daily_bonus_matches;
  end if;

  select coalesce(sum(a.xp_reward), 0)
  into achievement_xp
  from public.achievements a
  where a.family_id = p_family_id
    and (
      (a.code = 'first-completion' and approved_count >= 1)
      or (a.code = 'five-completions' and approved_count >= 5)
      or (a.code = 'three-day-streak' and streak >= 3)
      or (a.code = 'seven-day-streak' and streak >= 7)
      or (a.code = 'daily-bonus' and daily_bonus_days >= 1)
    );

  select coalesce(sum(ur.xp_cost_snapshot), 0)
  into reward_xp_spent
  from public.user_rewards ur
  join public.rewards r on r.id = ur.reward_id
  where ur.user_id = p_user_id
    and r.family_id = p_family_id
    and ur.status = 'approved';

  return greatest(0, base_xp + (daily_bonus_days * 15) + achievement_xp - reward_xp_spent);
end;
$$;

create or replace function public.ensure_user_reward_defaults()
returns trigger
language plpgsql
as $$
declare
  reward_row record;
  available_xp integer;
begin
  select r.id, r.family_id, r.xp_cost
  into reward_row
  from public.rewards r
  where r.id = new.reward_id;

  if reward_row.id is null then
    raise exception 'reward must exist';
  end if;

  available_xp := private.calculate_rewardable_xp(new.user_id, reward_row.family_id);

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.requested_at := coalesce(new.requested_at, now());
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.xp_cost_snapshot := reward_row.xp_cost;
    new.redeemed_by := coalesce(new.redeemed_by, new.user_id, auth.uid());

    if new.xp_cost_snapshot > available_xp then
      raise exception 'insufficient XP to request reward';
    end if;
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

    if new.status = 'approved' and new.xp_cost_snapshot > available_xp then
      raise exception 'insufficient XP to approve reward';
    end if;

    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;

  return new;
end;
$$;
