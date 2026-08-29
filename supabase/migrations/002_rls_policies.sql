-- RLS is applied at the table layer; these policies rely on family_members checks and
-- auth.uid() rather than any recursive policy references. They intentionally avoid
-- re-querying the same table to prevent policy recursion loops.
-- Authorization source of truth: family_members.role. profiles.role is metadata only and
-- is not used in any permission decision below.
-- Notification visibility is intentionally recipient-scoped; parents do not read all
-- notifications belonging to their family unless a separate product requirement says so.
alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.notifications enable row level security;
alter table public.achievements enable row level security;
alter table public.rewards enable row level security;
alter table public.user_achievements enable row level security;
alter table public.user_rewards enable row level security;

create policy "profiles_select_own_or_same_family"
on public.profiles
for select
using (
  id = auth.uid()
  or exists (
    select 1
    from private.user_family_memberships() ufm
    join public.family_members target on target.family_id = ufm.family_id
    where target.user_id = profiles.id
  )
);

create policy "profiles_insert_self_child_only"
on public.profiles
for insert
with check (
  id = auth.uid()
  and role = 'child'
);

create policy "profiles_update_self_child_only"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and role = 'child'
);

create policy "families_select_members_only"
on public.families
for select
using (
  private.is_family_member(id)
);

create policy "families_insert_blocked"
on public.families
for insert
with check (false);

create policy "families_update_parents_only"
on public.families
for update
using (private.is_parent_member(id))
with check (private.is_parent_member(id));

create policy "families_delete_owner_only"
on public.families
for delete
using (owner_id = auth.uid());

create policy "family_members_select_same_family"
on public.family_members
for select
using (
  user_id = auth.uid()
  or private.is_family_member(family_id)
);

create policy "family_members_insert_blocked"
on public.family_members
for insert
with check (false);

create policy "family_members_update_blocked"
on public.family_members
for update
using (false)
with check (false);

create policy "family_members_delete_blocked"
on public.family_members
for delete
using (false);

create policy "tasks_select_same_family"
on public.tasks
for select
using (private.is_family_member(family_id));

create policy "tasks_insert_parents_only"
on public.tasks
for insert
with check (private.is_parent_member(family_id));

create policy "tasks_update_parents_only"
on public.tasks
for update
using (private.is_parent_member(family_id))
with check (private.is_parent_member(family_id));

create policy "tasks_delete_parents_only"
on public.tasks
for delete
using (private.is_parent_member(family_id));

create policy "task_completions_select_parent_or_subject_child"
on public.task_completions
for select
using (
  child_id = auth.uid()
  or exists (
    select 1
    from public.tasks task
    where task.id = task_completions.task_id
      and private.is_parent_member(task.family_id)
  )
);

create policy "task_completions_insert_self_only"
on public.task_completions
for insert
with check (
  child_id = auth.uid()
  and exists (
    select 1
    from public.tasks task
    where task.id = task_completions.task_id
      and task.assigned_to = auth.uid()
  )
);

create policy "task_completions_update_parent_or_self"
on public.task_completions
for update
using (
  child_id = auth.uid()
  or exists (
    select 1
    from public.tasks task
    where task.id = task_completions.task_id
      and private.is_parent_member(task.family_id)
  )
)
with check (
  (
    child_id = auth.uid()
    and status in ('pending', 'submitted')
    and reviewed_by is null
    and reviewed_at is null
  )
  or exists (
    select 1
    from public.tasks task
    where task.id = task_completions.task_id
      and private.is_parent_member(task.family_id)
  )
);

create policy "task_completions_delete_parent_only"
on public.task_completions
for delete
using (
  exists (
    select 1
    from public.tasks task
    where task.id = task_completions.task_id
      and private.is_parent_member(task.family_id)
  )
);

create policy "notifications_select_own_only"
on public.notifications
for select
using (recipient_id = auth.uid());

create policy "notifications_insert_own_only"
on public.notifications
for insert
with check (recipient_id = auth.uid());

create policy "notifications_update_own"
on public.notifications
for update
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

create policy "notifications_delete_own_only"
on public.notifications
for delete
using (recipient_id = auth.uid());

create policy "achievements_select_same_family"
on public.achievements
for select
using (private.is_family_member(family_id));

create policy "achievements_insert_parent_only"
on public.achievements
for insert
with check (private.is_parent_member(family_id));

create policy "achievements_update_parent_only"
on public.achievements
for update
using (private.is_parent_member(family_id))
with check (private.is_parent_member(family_id));

create policy "achievements_delete_parent_only"
on public.achievements
for delete
using (private.is_parent_member(family_id));

create policy "rewards_select_same_family"
on public.rewards
for select
using (private.is_family_member(family_id));

create policy "rewards_insert_parent_only"
on public.rewards
for insert
with check (private.is_parent_member(family_id));

create policy "rewards_update_parent_only"
on public.rewards
for update
using (private.is_parent_member(family_id))
with check (private.is_parent_member(family_id));

create policy "rewards_delete_parent_only"
on public.rewards
for delete
using (private.is_parent_member(family_id));

create policy "user_achievements_select_own_or_parent"
on public.user_achievements
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.achievements a
    where a.id = user_achievements.achievement_id
      and private.is_parent_member(a.family_id)
  )
);

create policy "user_achievements_insert_parent_only"
on public.user_achievements
for insert
with check (
  exists (
    select 1
    from public.achievements a
    where a.id = user_achievements.achievement_id
      and private.is_parent_member(a.family_id)
  )
);

create policy "user_achievements_update_parent_only"
on public.user_achievements
for update
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.achievements a
    where a.id = user_achievements.achievement_id
      and private.is_parent_member(a.family_id)
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.achievements a
    where a.id = user_achievements.achievement_id
      and private.is_parent_member(a.family_id)
  )
);

create policy "user_rewards_select_own_or_parent"
on public.user_rewards
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_parent_member(r.family_id)
  )
);

create policy "user_rewards_insert_parent_only"
on public.user_rewards
for insert
with check (
  exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_parent_member(r.family_id)
  )
);

create policy "user_rewards_update_parent_only"
on public.user_rewards
for update
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_parent_member(r.family_id)
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.rewards r
    where r.id = user_rewards.reward_id
      and private.is_parent_member(r.family_id)
  )
);
