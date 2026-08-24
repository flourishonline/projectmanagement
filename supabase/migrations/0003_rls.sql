-- Flourish Ops — row level security
-- Every table is protected. Nothing is readable without an authenticated,
-- active session, and the anon role is granted nothing at all.

alter table public.profiles           enable row level security;
alter table public.folders            enable row level security;
alter table public.clients            enable row level security;
alter table public.projects           enable row level security;
alter table public.project_rates      enable row level security;
alter table public.project_members    enable row level security;
alter table public.retainer_configs   enable row level security;
alter table public.retainer_periods   enable row level security;
alter table public.bundle_configs     enable row level security;
alter table public.standalone_configs enable row level security;
alter table public.tasks              enable row level security;
alter table public.time_entries       enable row level security;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- Everyone signed in can see who else is on the team — names and avatars are
-- needed to render assignees. Nothing commercial lives on this table.
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_active_user());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Insert happens only through the SECURITY DEFINER auth trigger, and no policy
-- grants it here. Deletion follows the auth user.

-- ---------------------------------------------------------------------------
-- folders — readable by all, managed by admins
-- ---------------------------------------------------------------------------

create policy folders_select on public.folders
  for select to authenticated
  using (public.is_active_user());

create policy folders_write on public.folders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- clients
-- Members see only the clients behind a project they are assigned to.
-- ---------------------------------------------------------------------------

create policy clients_select on public.clients
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.projects p
      join public.project_members pm on pm.project_id = p.id
      where p.client_id = clients.id and pm.user_id = auth.uid()
    )
  );

create policy clients_write on public.clients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create policy projects_select on public.projects
  for select to authenticated
  using (public.can_see_project(id));

create policy projects_write on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Commercial tables — admin only, no read path for members at all.
-- This is where "members never see rate or revenue data" is actually enforced.
-- ---------------------------------------------------------------------------

create policy project_rates_admin on public.project_rates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy retainer_configs_admin on public.retainer_configs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy retainer_periods_admin on public.retainer_periods
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy bundle_configs_admin on public.bundle_configs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy standalone_configs_admin on public.standalone_configs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- project_members
-- A member may see their own assignments so the app can scope their views.
-- ---------------------------------------------------------------------------

create policy project_members_select on public.project_members
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

create policy project_members_write on public.project_members
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- tasks — scoped to visible projects; members may work their own board
-- ---------------------------------------------------------------------------

create policy tasks_select on public.tasks
  for select to authenticated
  using (public.can_see_project(project_id));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.can_see_project(project_id));

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_see_project(project_id))
  with check (public.can_see_project(project_id));

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- time_entries
-- Members: their own entries, on projects they are assigned to.
-- Admins: everything, including editing other people's time.
-- ---------------------------------------------------------------------------

create policy time_entries_select on public.time_entries
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (
    public.can_see_project(project_id)
    and (public.is_admin() or user_id = auth.uid())
  );

create policy time_entries_update on public.time_entries
  for update to authenticated
  using (public.is_admin() or (user_id = auth.uid() and deleted_at is null))
  with check (
    public.can_see_project(project_id)
    and (public.is_admin() or user_id = auth.uid())
  );

-- Deletion is soft: members set deleted_at through the update policy above.
-- Only an admin may remove a row permanently, and only after review.
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.is_admin());
