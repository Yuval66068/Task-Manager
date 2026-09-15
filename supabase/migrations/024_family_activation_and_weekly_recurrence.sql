-- ============================================================
-- 024_family_activation_and_weekly_recurrence.sql
-- ============================================================
-- Add persistent family onboarding completion state and selected-day weekly
-- recurrence support without changing the existing daily/weekly/monthly
-- recurrence engine semantics.

alter table public.families
  add column if not exists onboarding_completed_at timestamptz null;

update public.families
set onboarding_completed_at = now()
where onboarding_completed_at is null;

alter table public.tasks
  add column if not exists recurrence_days smallint[] null;

alter table public.tasks
  add constraint tasks_recurrence_days_check
  check (
    recurrence_days is null
    or (
      recurrence = 'weekly'
      and recurrence_days is not null
      and cardinality(recurrence_days) > 0
      and recurrence_days <@ array[0,1,2,3,4,5,6]::smallint[]
    )
  );

create or replace function private.set_family_onboarding_completed()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  if new.family_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.families f
    where f.id = new.family_id
      and f.onboarding_completed_at is null
      and exists (
        select 1
        from public.family_members fm
        where fm.family_id = new.family_id
          and fm.role = 'child'
      )
  ) then
    update public.families
    set onboarding_completed_at = now()
    where id = new.family_id
      and onboarding_completed_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_mark_family_onboarding_complete on public.tasks;
create trigger tasks_mark_family_onboarding_complete
after insert on public.tasks
for each row
execute function private.set_family_onboarding_completed();

comment on column public.families.onboarding_completed_at is
  'Marks the family as having completed onboarding after at least one child and one genuine task exist. Null means onboarding is still pending for a newly created family.';

comment on column public.tasks.recurrence_days is
  'Optional selected weekdays for weekly tasks, represented as Sunday=0 ... Saturday=6. Legacy weekly tasks with NULL keep the current behavior unchanged.';
