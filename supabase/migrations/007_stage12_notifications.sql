alter type public.notification_type add value if not exists 'task_deadline';
alter type public.notification_type add value if not exists 'task_overdue';
alter type public.notification_type add value if not exists 'reward_requested';
alter type public.notification_type add value if not exists 'reward_approved';
alter type public.notification_type add value if not exists 'reward_rejected';

alter table public.notifications
  add column if not exists task_id uuid references public.tasks (id) on delete set null,
  add column if not exists reward_id uuid references public.rewards (id) on delete set null;

create index if not exists idx_notifications_recipient_read_created_at
  on public.notifications (recipient_id, is_read, created_at desc);

create or replace function private.create_notification(
  p_family_id uuid,
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type public.notification_type,
  p_message text,
  p_task_id uuid default null,
  p_reward_id uuid default null
)
returns void
security definer
set search_path = ''
language plpgsql
as $$
begin
  if p_recipient_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.family_id = p_family_id
      and n.recipient_id = p_recipient_id
      and n.type = p_type
      and coalesce(n.task_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(n.reward_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_reward_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    return;
  end if;

  insert into public.notifications (
    family_id,
    recipient_id,
    actor_id,
    type,
    message,
    task_id,
    reward_id
  )
  values (
    p_family_id,
    p_recipient_id,
    p_actor_id,
    p_type,
    p_message,
    p_task_id,
    p_reward_id
  );
end;
$$;

create or replace function private.sync_task_notifications()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := coalesce(auth.uid(), new.created_by);
  if v_actor_id is null and tg_op <> 'INSERT' then
    v_actor_id := old.created_by;
  end if;

  if tg_op = 'INSERT' then
    perform private.create_notification(
      new.family_id,
      new.assigned_to,
      v_actor_id,
      'task_assigned'::public.notification_type,
      format('משימה חדשה: %s', new.title),
      new.id,
      null
    );
    return new;
  end if;

  if old.assigned_to is distinct from new.assigned_to then
    perform private.create_notification(
      new.family_id,
      new.assigned_to,
      v_actor_id,
      'task_assigned'::public.notification_type,
      format('משימה עודכנה: %s', new.title),
      new.id,
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_set_notifications on public.tasks;
create trigger tasks_set_notifications
after insert or update of title, assigned_to on public.tasks
for each row
execute function private.sync_task_notifications();

create or replace function private.sync_task_completion_notifications()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_task record;
  v_parent_id uuid;
  v_actor_id uuid := coalesce(auth.uid(), new.reviewed_by, new.child_id);
begin
  select t.id, t.family_id, t.title
  into v_task
  from public.tasks t
  where t.id = new.task_id;

  if v_task.id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    for v_parent_id in
      select fm.user_id
      from public.family_members fm
      where fm.family_id = v_task.family_id
        and fm.role = 'parent'
    loop
      perform private.create_notification(
        v_task.family_id,
        v_parent_id,
        new.child_id,
        'task_completed'::public.notification_type,
        format('%s נשלחה לאישור', v_task.title),
        v_task.id,
        null
      );
    end loop;
  elsif old.status is distinct from new.status and new.status = 'submitted' then
    for v_parent_id in
      select fm.user_id
      from public.family_members fm
      where fm.family_id = v_task.family_id
        and fm.role = 'parent'
    loop
      perform private.create_notification(
        v_task.family_id,
        v_parent_id,
        new.child_id,
        'task_completed'::public.notification_type,
        format('%s נשלחה לאישור', v_task.title),
        v_task.id,
        null
      );
    end loop;
  end if;

  if old.status is distinct from new.status and new.status in ('approved', 'rejected') then
    perform private.create_notification(
      v_task.family_id,
      new.child_id,
      v_actor_id,
      (case when new.status = 'approved' then 'task_approved' else 'task_rejected' end)::public.notification_type,
      case when new.status = 'approved' then format('%s אושרה', v_task.title) else format('%s נדחתה', v_task.title) end,
      v_task.id,
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists task_completions_set_notifications on public.task_completions;
create trigger task_completions_set_notifications
after insert or update of status on public.task_completions
for each row
execute function private.sync_task_completion_notifications();

create or replace function private.sync_reward_notifications()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_reward record;
  v_parent_id uuid;
  v_actor_id uuid := coalesce(auth.uid(), new.reviewed_by, new.user_id);
begin
  select r.id, r.family_id, r.title
  into v_reward
  from public.rewards r
  where r.id = new.reward_id;

  if v_reward.id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    for v_parent_id in
      select fm.user_id
      from public.family_members fm
      where fm.family_id = v_reward.family_id
        and fm.role = 'parent'
    loop
      perform private.create_notification(
        v_reward.family_id,
        v_parent_id,
        new.user_id,
        'reward_requested'::public.notification_type,
        format('בקשת פרס חדשה: %s', v_reward.title),
        null,
        v_reward.id
      );
    end loop;
  elsif old.status is distinct from new.status and new.status in ('approved', 'rejected') then
    perform private.create_notification(
      v_reward.family_id,
      new.user_id,
      v_actor_id,
      (case when new.status = 'approved' then 'reward_approved' else 'reward_rejected' end)::public.notification_type,
      case when new.status = 'approved' then format('הפרס "%s" אושר', v_reward.title) else format('הפרס "%s" נדחה', v_reward.title) end,
      null,
      v_reward.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists user_rewards_set_notifications on public.user_rewards;
create trigger user_rewards_set_notifications
after insert or update of status on public.user_rewards
for each row
execute function private.sync_reward_notifications();

create or replace function private.generate_task_notifications()
returns void
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_task record;
begin
  for v_task in
    select t.id, t.family_id, t.title, t.assigned_to, t.due_at, t.status
    from public.tasks t
    where t.due_at is not null
      and t.status not in ('approved', 'rejected')
  loop
    if v_task.due_at <= now() and v_task.status <> 'overdue' then
      perform private.create_notification(
        v_task.family_id,
        v_task.assigned_to,
        null,
        'task_overdue'::public.notification_type,
        format('משימה באיחור: %s', v_task.title),
        v_task.id,
        null
      );
    elsif v_task.due_at > now()
      and v_task.due_at <= now() + interval '24 hours' then
      perform private.create_notification(
        v_task.family_id,
        v_task.assigned_to,
        null,
        'task_deadline'::public.notification_type,
        format('מועד אחרון מתקרב: %s', v_task.title),
        v_task.id,
        null
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'stage12-task-notifications'
  ) then
    perform cron.schedule(
      'stage12-task-notifications',
      '15 * * * *',
      'select private.generate_task_notifications();'
    );
  end if;
end;
$$;

select private.generate_task_notifications();
