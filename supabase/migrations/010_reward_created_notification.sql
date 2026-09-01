-- Additive migration: notify all children in a family when a parent creates a new reward.
-- Does not touch task triggers, user_rewards triggers, Realtime, RLS, or existing 007 migration.
-- Depends on 009_add_reward_created_notification_type.sql having been applied first.

create or replace function private.sync_reward_created_notifications()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
declare
  v_child_id uuid;
begin
  for v_child_id in
    select fm.user_id
    from public.family_members fm
    where fm.family_id = new.family_id
      and fm.role = 'child'
  loop
    perform private.create_notification(
      new.family_id,
      v_child_id,
      new.created_by,
      'reward_created'::public.notification_type,
      format('פרס חדש מחכה לך: %s', new.title),
      null,
      new.id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists rewards_set_created_notifications on public.rewards;
create trigger rewards_set_created_notifications
after insert on public.rewards
for each row
execute function private.sync_reward_created_notifications();
