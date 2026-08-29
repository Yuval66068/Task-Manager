-- Safe verification script for a privileged database role.
-- Run these queries only in a trusted testing environment after the schema is applied.
-- These examples intentionally avoid real family data and use placeholder IDs.

-- 1) Parent A can read Family A members
-- select * from public.family_members where family_id = '00000000-0000-0000-0000-000000000001';

-- 2) Child A can read only own family data
-- select * from public.tasks where family_id = '00000000-0000-0000-0000-000000000001' and assigned_to = '00000000-0000-0000-0000-000000000002';

-- 3) Parent B cannot read Family A
-- select * from public.families where id = '00000000-0000-0000-0000-000000000001';

-- 4) Child B cannot access Family A tasks
-- select * from public.tasks where family_id = '00000000-0000-0000-0000-000000000001';

-- 5) Child A cannot update parent-only data
-- update public.tasks set title = 'hacked by child' where id = '00000000-0000-0000-0000-000000000003';

-- 6) Child A cannot modify another child's task
-- update public.tasks set title = 'tampered by child' where assigned_to = '00000000-0000-0000-0000-000000000004';

-- 7) Parent approves a child task completion
-- update public.task_completions set status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000005', reviewed_at = now() where id = '00000000-0000-0000-0000-000000000006';

-- 8) Child tries to approve their own task completion
-- update public.task_completions set status = 'approved' where child_id = '00000000-0000-0000-0000-000000000002';

-- Expected behavior: the queries above should fail with RLS restrictions unless executed by an authorized user in the correct family context.
