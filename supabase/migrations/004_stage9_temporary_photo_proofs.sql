create extension if not exists pg_cron;

alter table public.tasks
  add column if not exists requires_photo boolean not null default false;

insert into storage.buckets (id, name, public)
values ('temporary-task-proofs', 'temporary-task-proofs', false)
on conflict (id) do update
set public = excluded.public,
    name = excluded.name;

drop policy if exists "task_proofs_select_family_members" on storage.objects;
create policy "task_proofs_select_family_members"
on storage.objects
for select
using (
  bucket_id = 'temporary-task-proofs'
  and exists (
    select 1
    from public.tasks task
    where task.id = split_part(name, '/', 4)::uuid
      and (
        private.is_parent_member(task.family_id)
        or (
          task.assigned_to = auth.uid()
          and exists (
            select 1
            from public.family_members fm
            where fm.family_id = task.family_id
              and fm.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists "task_proofs_insert_assigned_child_only" on storage.objects;
create policy "task_proofs_insert_assigned_child_only"
on storage.objects
for insert
with check (
  bucket_id = 'temporary-task-proofs'
  and auth.uid() is not null
  and split_part(name, '/', 6)::uuid = auth.uid()
  and exists (
    select 1
    from public.tasks task
    where task.id = split_part(name, '/', 4)::uuid
      and task.family_id = split_part(name, '/', 2)::uuid
      and task.assigned_to = auth.uid()
      and exists (
        select 1
        from public.family_members fm
        where fm.family_id = task.family_id
          and fm.user_id = auth.uid()
          and fm.role = 'child'
      )
  )
);

drop policy if exists "task_proofs_delete_family_parent_only" on storage.objects;
create policy "task_proofs_delete_family_parent_only"
on storage.objects
for delete
using (
  bucket_id = 'temporary-task-proofs'
  and exists (
    select 1
    from public.tasks task
    where task.id = split_part(name, '/', 4)::uuid
      and private.is_parent_member(task.family_id)
  )
);

create or replace function private.cleanup_expired_task_proofs()
returns void
security definer
set search_path = ''
language plpgsql
as $$
declare
  proof_row record;
begin
  for proof_row in
    select tc.id, tc.proof_photo_url
    from public.task_completions tc
    where tc.status = 'submitted'
      and tc.proof_photo_url is not null
      and tc.submitted_at < now() - interval '24 hours'
  loop
    delete from storage.objects
    where bucket_id = 'temporary-task-proofs'
      and name = proof_row.proof_photo_url;

    update public.task_completions
    set proof_photo_url = null
    where id = proof_row.id;
  end loop;
end;
$$;

select cron.schedule(
  'cleanup-expired-task-proofs',
  '@hourly',
  $$select private.cleanup_expired_task_proofs();$$
);
