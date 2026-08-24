-- Flourish Ops — functions and triggers

-- ---------------------------------------------------------------------------
-- Which email domain may hold an account.
-- This is the second of the two enforcement points named in the brief; the
-- first is the hosted-domain restriction on the Supabase Google provider and
-- the third is the server-side check in the OAuth callback. Any one of them
-- failing still leaves the account locked out.
-- ---------------------------------------------------------------------------

create or replace function public.allowed_email_domain()
returns text
language sql
immutable
as $$ select 'flourishonline.com.au'::text $$;

-- ---------------------------------------------------------------------------
-- Provision a profile on first sign-in. Rejects any address outside the domain.
-- The first account to arrive becomes admin; everyone after defaults to member.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_domain      text := public.allowed_email_domain();
  v_is_first    boolean;
  v_role        public.user_role;
begin
  if new.email is null or lower(new.email) not like ('%@' || v_domain) then
    raise exception using
      errcode = '42501',
      message = format('Only @%s accounts may sign in to Flourish Ops.', v_domain);
  end if;

  -- Serialise the first-user check so two simultaneous sign-ins cannot both
  -- see an empty table and both become admin.
  perform pg_advisory_xact_lock(hashtext('flourish_ops_first_user'));

  select not exists (select 1 from public.profiles) into v_is_first;
  v_role := case when v_is_first then 'admin' else 'member' end::public.user_role;

  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    lower(new.email),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                          new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url',
                          new.raw_user_meta_data ->> 'picture', '')), ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Authorisation helpers.
-- SECURITY DEFINER so they read the underlying tables without re-entering the
-- policies that call them, which would otherwise recurse.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and active
  );
$$;

create or replace function public.can_see_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (
        select 1 from public.project_members
        where project_id = p_project_id and user_id = auth.uid()
      );
$$;

-- ---------------------------------------------------------------------------
-- Keep duration_seconds in step with the timestamps. Duration is derived, never
-- entered directly — manual entry supplies an end time computed from the hours
-- the user typed, so the stored seconds and the stored timestamps can never
-- disagree.
-- ---------------------------------------------------------------------------

create or replace function public.sync_time_entry_duration()
returns trigger
language plpgsql
as $$
begin
  if new.ended_at is null then
    new.duration_seconds := null;
  else
    new.duration_seconds := floor(extract(epoch from (new.ended_at - new.started_at)))::integer;
  end if;

  if tg_op = 'UPDATE' and (
       new.started_at  is distinct from old.started_at
    or new.ended_at    is distinct from old.ended_at
    or new.project_id  is distinct from old.project_id
    or new.task_id     is distinct from old.task_id
    or new.description is distinct from old.description
    or new.billable    is distinct from old.billable
  ) then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

create trigger time_entries_sync_duration
  before insert or update on public.time_entries
  for each row execute function public.sync_time_entry_duration();

-- ---------------------------------------------------------------------------
-- Only admins may change a role, and the last admin cannot be demoted or
-- deactivated — otherwise the instance locks itself out of its own admin screens.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Only an admin may change roles or deactivate an account.';
  end if;

  if old.role = 'admin'
     and (new.role is distinct from 'admin' or new.active = false)
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and active and id <> old.id
     ) then
    raise exception using
      errcode = '23514',
      message = 'This is the only active admin. Promote someone else first.';
  end if;

  new.email := old.email;  -- identity is owned by the auth provider
  return new;
end;
$$;

create trigger profiles_guard_changes
  before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- ---------------------------------------------------------------------------
-- Housekeeping timestamps
-- ---------------------------------------------------------------------------

create or replace function public.sync_project_archived_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'archived' and coalesce(old.status, 'active') <> 'archived' then
    new.archived_at := now();
  elsif new.status <> 'archived' then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger projects_sync_archived_at
  before insert or update on public.projects
  for each row execute function public.sync_project_archived_at();

create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and coalesce(old.status, 'todo') <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_completed_at
  before insert or update on public.tasks
  for each row execute function public.sync_task_completed_at();

-- A task may only be attached to a time entry that shares its project.
create or replace function public.check_time_entry_task_project()
returns trigger
language plpgsql
as $$
declare
  v_task_project uuid;
begin
  if new.task_id is null then
    return new;
  end if;

  select project_id into v_task_project from public.tasks where id = new.task_id;

  if v_task_project is distinct from new.project_id then
    raise exception using
      errcode = '23514',
      message = 'The selected task belongs to a different project.';
  end if;

  return new;
end;
$$;

create trigger time_entries_check_task_project
  before insert or update on public.time_entries
  for each row execute function public.check_time_entry_task_project();
