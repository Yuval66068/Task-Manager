-- Fix regression: private.generate_task_notifications() flips tasks to
-- 'overdue' but never creates the corresponding task_overdue notifications
-- for the assigned child and the family's parents.
--
-- Root cause: the function performs
--   update public.tasks set status = 'overdue' where id = v_task.id;
-- directly, which also causes the tasks_sync_overdue_state trigger
-- (private.sync_task_overdue_state, see 015_task_stability.sql) to fire
-- with new.status already equal to 'overdue' for this statement, so its
-- own "new.status is distinct from 'overdue'" guard is false and it skips
-- creating notifications too. Net result: no task_overdue notification is
-- ever created for occurrences transitioned by the cron job.
--
-- Fix: create the task_overdue notifications directly inside
-- private.generate_task_notifications(), reusing private.create_notification
-- (7_stage12_notifications.sql), which already de-duplicates on
-- (family_id, recipient_id, type, task_id, reward_id) existence, so this is
-- safe to call on every cron run without creating duplicate rows -- whether
-- the transition happened via this function or via the trigger.

create or replace function private.generate_task_notifications()
returns void
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_task record;
  v_parent_id uuid;
begin
  for v_task in
    select t.id, t.family_id, t.title, t.assigned_to, t.due_at, t.status, t.created_by
    from public.tasks t
    where t.due_at is not null
      and t.status not in ('approved', 'rejected', 'completed')
  loop
    if v_task.due_at <= now() then
      if v_task.status is distinct from 'overdue' then
        update public.tasks
        set status = 'overdue', updated_at = now()
        where id = v_task.id
          and status is distinct from 'overdue';
      end if;

      -- Always attempt notification creation (idempotent via
      -- private.create_notification dedup), even if the task is already
      -- 'overdue', so previously-missed notifications self-heal.
      -- Notify the assigned child.
      perform private.create_notification(
        v_task.family_id,
        v_task.assigned_to,
        v_task.created_by,
        'task_overdue'::public.notification_type,
        format('משימה באיחור: %s', v_task.title),
        v_task.id,
        null
      );

      -- Notify every parent in the family.
      for v_parent_id in
        select fm.user_id
        from public.family_members fm
        where fm.family_id = v_task.family_id
          and fm.role = 'parent'
      loop
        perform private.create_notification(
          v_task.family_id,
          v_parent_id,
          v_task.created_by,
          'task_overdue'::public.notification_type,
          format('משימה באיחור: %s', v_task.title),
          v_task.id,
          null
        );
      end loop;
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
