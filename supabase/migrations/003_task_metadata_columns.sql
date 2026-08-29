alter table public.tasks
  add column if not exists priority text not null default 'medium';

alter table public.tasks
  add column if not exists recurrence text not null default 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_priority_allowed'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_priority_allowed
      CHECK (priority IN ('low', 'medium', 'high')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_recurrence_allowed'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_recurrence_allowed
      CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')) NOT VALID;
  END IF;
END $$;
