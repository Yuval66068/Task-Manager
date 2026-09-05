-- Additive stability fix for overdue tasks and parent overdue notifications.
-- This file is not applied automatically in this session; it is included as the
-- database-side companion for the app-side stability fixes in this repo.

alter table public.tasks
  add column if not exists recurrence_source_task_id uuid references public.tasks (id) on delete set null,
  add column if not exists recurrence_anchor_day smallint;

alter table public.tasks
  add constraint tasks_recurrence_anchor_day_allowed
  check (recurrence_anchor_day is null or recurrence_anchor_day between 1 and 31);

create unique index if not exists idx_tasks_single_next_recurrence_per_source
  on public.tasks (recurrence_source_task_id)
  where recurrence_source_task_id is not null;

create or replace function private.sync_task_overdue_state()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_parent_id uuid;
begin
  if new.status in ('approved', 'rejected', 'completed') then
    return new;
  end if;

  if old.status = 'overdue' and (
    new.due_at is null or new.due_at > now()
  ) then
    update public.tasks
    set status = 'pending', updated_at = now()
    where id = new.id
      and status = 'overdue';

    return new;
  end if;

  if new.due_at is null then
    return new;
  end if;

  if new.due_at <= now() and new.status is distinct from 'overdue' then
    update public.tasks
    set status = 'overdue', updated_at = now()
    where id = new.id
      and status is distinct from 'overdue';

    -- The trigger is the single source of overdue notifications.
    perform private.create_notification(
      new.family_id,
      new.assigned_to,
      coalesce(auth.uid(), new.created_by),
      'task_overdue'::public.notification_type,
      format('משימה באיחור: %s', new.title),
      new.id,
      null
    );

    for v_parent_id in
      select fm.user_id
      from public.family_members fm
      where fm.family_id = new.family_id
        and fm.role = 'parent'
    loop
      perform private.create_notification(
        new.family_id,
        v_parent_id,
        coalesce(auth.uid(), new.created_by),
        'task_overdue'::public.notification_type,
        format('משימה באיחור: %s', new.title),
        new.id,
        null
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_task_overdue_state() from public;
revoke all on function private.sync_task_overdue_state() from anon;
revoke all on function private.sync_task_overdue_state() from authenticated;
grant execute on function private.sync_task_overdue_state() to service_role;
grant execute on function private.sync_task_overdue_state() to postgres;

drop trigger if exists tasks_sync_overdue_state on public.tasks;
create trigger tasks_sync_overdue_state
after insert or update of due_at, status
on public.tasks
for each row
execute function private.sync_task_overdue_state();

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
    select t.id, t.family_id, t.title, t.assigned_to, t.due_at, t.status, t.created_by
    from public.tasks t
    where t.due_at is not null
      and t.status not in ('approved', 'rejected', 'completed')
  loop
    if v_task.due_at <= now() and v_task.status is distinct from 'overdue' then
      update public.tasks
      set status = 'overdue', updated_at = now()
      where id = v_task.id;
    elsif v_task.due_at > now()
      and v_task.due_at <= now() + interval '24 hours'
      and v_task.status is distinct from 'overdue'
    then
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

revoke all on function private.generate_task_notifications() from public;
revoke all on function private.generate_task_notifications() from anon;
revoke all on function private.generate_task_notifications() from authenticated;
grant execute on function private.generate_task_notifications() to service_role;
grant execute on function private.generate_task_notifications() to postgres;
