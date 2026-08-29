-- Privileged bootstrap for Stage 4 RLS verification.
-- This file is intentionally not executed automatically.
-- It creates only uniquely identifiable test data and must never touch unrelated production rows.
-- Run this only from an approved admin/SQL environment after the real test accounts exist.

DO $$
DECLARE
  v_parent_a_id uuid;
  v_child_a_id uuid;
  v_parent_b_id uuid;
  v_child_b_id uuid;
  v_family_a_id uuid;
  v_family_b_id uuid;
  v_task_a_id uuid;
  v_task_b_id uuid;
  v_member_role public.user_role;
BEGIN
  SELECT id INTO v_parent_a_id
  FROM public.profiles
  WHERE email = '__PARENT_A_EMAIL__';
  IF v_parent_a_id IS NULL THEN
    RAISE EXCEPTION 'Missing required public.profiles row for Parent A: __PARENT_A_EMAIL__';
  END IF;

  SELECT id INTO v_child_a_id
  FROM public.profiles
  WHERE email = '__CHILD_A_EMAIL__';
  IF v_child_a_id IS NULL THEN
    RAISE EXCEPTION 'Missing required public.profiles row for Child A: __CHILD_A_EMAIL__';
  END IF;

  SELECT id INTO v_parent_b_id
  FROM public.profiles
  WHERE email = '__PARENT_B_EMAIL__';
  IF v_parent_b_id IS NULL THEN
    RAISE EXCEPTION 'Missing required public.profiles row for Parent B: __PARENT_B_EMAIL__';
  END IF;

  SELECT id INTO v_child_b_id
  FROM public.profiles
  WHERE email = '__CHILD_B_EMAIL__';
  IF v_child_b_id IS NULL THEN
    RAISE EXCEPTION 'Missing required public.profiles row for Child B: __CHILD_B_EMAIL__';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.families f
    WHERE f.name = 'RLS_TEST_FAMILY_A'
      AND f.owner_id <> v_parent_a_id
  ) THEN
    RAISE EXCEPTION 'Existing RLS_TEST_FAMILY_A owner does not match the intended Parent A user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.families f
    WHERE f.name = 'RLS_TEST_FAMILY_B'
      AND f.owner_id <> v_parent_b_id
  ) THEN
    RAISE EXCEPTION 'Existing RLS_TEST_FAMILY_B owner does not match the intended Parent B user';
  END IF;

  SELECT id INTO v_family_a_id
  FROM public.families
  WHERE name = 'RLS_TEST_FAMILY_A';
  IF v_family_a_id IS NULL THEN
    INSERT INTO public.families (name, owner_id)
    VALUES ('RLS_TEST_FAMILY_A', v_parent_a_id)
    RETURNING id INTO v_family_a_id;
  END IF;

  SELECT id INTO v_family_b_id
  FROM public.families
  WHERE name = 'RLS_TEST_FAMILY_B';
  IF v_family_b_id IS NULL THEN
    INSERT INTO public.families (name, owner_id)
    VALUES ('RLS_TEST_FAMILY_B', v_parent_b_id)
    RETURNING id INTO v_family_b_id;
  END IF;

  SELECT role INTO v_member_role
  FROM public.family_members
  WHERE family_id = v_family_a_id
    AND user_id = v_child_a_id;
  IF v_member_role IS NULL THEN
    INSERT INTO public.family_members (family_id, user_id, role)
    VALUES (v_family_a_id, v_child_a_id, 'child');
  ELSIF v_member_role <> 'child' THEN
    RAISE EXCEPTION 'Family A child membership for Child A exists with an unexpected role';
  END IF;

  SELECT role INTO v_member_role
  FROM public.family_members
  WHERE family_id = v_family_a_id
    AND user_id = v_parent_a_id;
  IF v_member_role IS NULL THEN
    INSERT INTO public.family_members (family_id, user_id, role)
    VALUES (v_family_a_id, v_parent_a_id, 'parent');
  ELSIF v_member_role <> 'parent' THEN
    RAISE EXCEPTION 'Family A parent membership for Parent A exists with an unexpected role';
  END IF;

  SELECT role INTO v_member_role
  FROM public.family_members
  WHERE family_id = v_family_b_id
    AND user_id = v_child_b_id;
  IF v_member_role IS NULL THEN
    INSERT INTO public.family_members (family_id, user_id, role)
    VALUES (v_family_b_id, v_child_b_id, 'child');
  ELSIF v_member_role <> 'child' THEN
    RAISE EXCEPTION 'Family B child membership for Child B exists with an unexpected role';
  END IF;

  SELECT role INTO v_member_role
  FROM public.family_members
  WHERE family_id = v_family_b_id
    AND user_id = v_parent_b_id;
  IF v_member_role IS NULL THEN
    INSERT INTO public.family_members (family_id, user_id, role)
    VALUES (v_family_b_id, v_parent_b_id, 'parent');
  ELSIF v_member_role <> 'parent' THEN
    RAISE EXCEPTION 'Family B parent membership for Parent B exists with an unexpected role';
  END IF;

  SELECT id INTO v_task_a_id
  FROM public.tasks
  WHERE family_id = v_family_a_id
    AND title = 'RLS_TEST_TASK_A';
  IF v_task_a_id IS NULL THEN
    INSERT INTO public.tasks (family_id, title, description, emoji, xp, assigned_to, created_by, status)
    VALUES (v_family_a_id, 'RLS_TEST_TASK_A', 'Test task for Family A', '✅', 15, v_child_a_id, v_parent_a_id, 'pending')
    RETURNING id INTO v_task_a_id;
  END IF;

  SELECT id INTO v_task_b_id
  FROM public.tasks
  WHERE family_id = v_family_b_id
    AND title = 'RLS_TEST_TASK_B';
  IF v_task_b_id IS NULL THEN
    INSERT INTO public.tasks (family_id, title, description, emoji, xp, assigned_to, created_by, status)
    VALUES (v_family_b_id, 'RLS_TEST_TASK_B', 'Test task for Family B', '✅', 15, v_child_b_id, v_parent_b_id, 'pending')
    RETURNING id INTO v_task_b_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.task_completions tc
    WHERE tc.task_id = v_task_a_id
      AND tc.child_id = v_child_a_id
  ) THEN
    INSERT INTO public.task_completions (task_id, child_id, status, completion_note)
    VALUES (v_task_a_id, v_child_a_id, 'submitted', 'RLS test completion');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.task_completions tc
    WHERE tc.task_id = v_task_b_id
      AND tc.child_id = v_child_b_id
  ) THEN
    INSERT INTO public.task_completions (task_id, child_id, status, completion_note)
    VALUES (v_task_b_id, v_child_b_id, 'submitted', 'RLS test completion');
  END IF;
END $$;

-- NOTE:
-- 1. This script is intentionally idempotent and uses namespaced test data.
-- 2. It never deletes or updates unrelated production rows.
-- 3. It fails clearly if any required profile or family owner is inconsistent.
-- 4. It keeps the bootstrap admin-only and separate from the authenticated RLS assertions.
