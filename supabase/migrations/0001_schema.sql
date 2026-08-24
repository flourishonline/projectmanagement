-- Flourish Ops — core schema
-- All timestamps are stored UTC (timestamptz) and rendered in Australia/Brisbane.
-- All durations are stored in seconds. Never round stored data.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type user_role       as enum ('admin', 'member');
create type client_status   as enum ('active', 'archived');
create type project_type    as enum ('retainer', 'bundle', 'standalone');
create type project_status  as enum ('active', 'paused', 'complete', 'archived');
create type task_status     as enum ('todo', 'in_progress', 'blocked', 'done');

-- ---------------------------------------------------------------------------
-- profiles
-- One row per authenticated staff member. Created by the auth trigger only.
-- ---------------------------------------------------------------------------

create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text        not null unique,
  full_name   text,
  avatar_url  text,
  role        user_role   not null default 'member',
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is
  'Staff members. The first account to sign in is promoted to admin; everyone else defaults to member.';

-- ---------------------------------------------------------------------------
-- folders — navigation grouping only, no logic attached
-- ---------------------------------------------------------------------------

create table folders (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index folders_sort_order_idx on folders (sort_order, name);

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

create table clients (
  id          uuid primary key default gen_random_uuid(),
  name        text          not null,
  status      client_status not null default 'active',
  notes       text,
  created_at  timestamptz   not null default now()
);

create index clients_status_idx on clients (status, name);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid           not null references clients (id) on delete restrict,
  folder_id   uuid           references folders (id) on delete set null,
  name        text           not null,
  type        project_type   not null,
  status      project_status not null default 'active',
  notes       text,
  created_at  timestamptz    not null default now(),
  archived_at timestamptz
);

create index projects_client_idx on projects (client_id);
create index projects_folder_idx on projects (folder_id);
create index projects_status_idx on projects (status, type);

comment on column projects.archived_at is
  'Set when status moves to archived. Kept separate so archive views can sort by when, not just whether.';

-- ---------------------------------------------------------------------------
-- project_rates
-- The hourly rate lives in its own table so that "members never see rate data"
-- can be enforced by row-level security. Postgres RLS cannot hide a single
-- column from one authenticated user and show it to another, and every
-- Supabase session shares the `authenticated` role, so a rate column on
-- `projects` could only ever be hidden in the UI. This split makes the rule real.
-- ---------------------------------------------------------------------------

create table project_rates (
  project_id          uuid primary key references projects (id) on delete cascade,
  default_hourly_rate numeric(10, 2) not null check (default_hourly_rate >= 0),
  updated_at          timestamptz    not null default now()
);

-- ---------------------------------------------------------------------------
-- project_members — which members can see which projects
-- ---------------------------------------------------------------------------

create table project_members (
  project_id uuid        not null references projects (id) on delete cascade,
  user_id    uuid        not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on project_members (user_id);

-- ---------------------------------------------------------------------------
-- retainer_configs — one per retainer project
-- ---------------------------------------------------------------------------

create table retainer_configs (
  project_id           uuid primary key references projects (id) on delete cascade,
  monthly_hours        numeric(8, 2) not null check (monthly_hours > 0),
  billing_day_of_month smallint      not null default 1 check (billing_day_of_month between 1 and 31),
  rollover_enabled     boolean       not null default false,
  rollover_cap_hours   numeric(8, 2) check (rollover_cap_hours >= 0),
  start_date           date          not null,
  end_date             date,
  created_at           timestamptz   not null default now(),
  constraint retainer_end_after_start check (end_date is null or end_date >= start_date),
  constraint retainer_cap_needs_rollover check (rollover_cap_hours is null or rollover_enabled)
);

comment on column retainer_configs.billing_day_of_month is
  'Day the period rolls over. Flourish retainers reset on the 1st, which is the default; the column exists so an off-cycle client can be handled without a migration. Clamped to the last day of shorter months (31 becomes 28/29/30 as needed).';

-- ---------------------------------------------------------------------------
-- retainer_periods — one row per month per retainer
-- ---------------------------------------------------------------------------

create table retainer_periods (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid          not null references projects (id) on delete cascade,
  period_start     date          not null,
  period_end       date          not null,
  allocated_hours  numeric(8, 2) not null check (allocated_hours >= 0),
  rolled_in_hours  numeric(8, 2) not null default 0 check (rolled_in_hours >= 0),
  closed           boolean       not null default false,
  closed_at        timestamptz,
  created_at       timestamptz   not null default now(),
  unique (project_id, period_start),
  constraint period_end_after_start check (period_end >= period_start)
);

create index retainer_periods_project_idx on retainer_periods (project_id, period_start desc);

-- ---------------------------------------------------------------------------
-- bundle_configs — one row per purchase; top-ups add rows
-- ---------------------------------------------------------------------------

create table bundle_configs (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid          not null references projects (id) on delete cascade,
  purchased_hours           numeric(8, 2) not null check (purchased_hours > 0),
  purchase_date             date          not null,
  expiry_date               date,
  low_balance_threshold_pct smallint      not null default 75
                              check (low_balance_threshold_pct between 1 and 100),
  note                      text,
  created_at                timestamptz   not null default now(),
  constraint bundle_expiry_after_purchase check (expiry_date is null or expiry_date >= purchase_date)
);

create index bundle_configs_project_idx on bundle_configs (project_id, purchase_date);

-- ---------------------------------------------------------------------------
-- standalone_configs — fixed fee; hours tracked for margin only
-- ---------------------------------------------------------------------------

create table standalone_configs (
  project_id    uuid primary key references projects (id) on delete cascade,
  quoted_hours  numeric(8, 2)  not null check (quoted_hours > 0),
  fixed_fee     numeric(12, 2) not null check (fixed_fee >= 0),
  start_date    date           not null,
  due_date      date,
  created_at    timestamptz    not null default now(),
  constraint standalone_due_after_start check (due_date is null or due_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid        not null references projects (id) on delete cascade,
  title          text        not null check (length(btrim(title)) > 0),
  description    text,
  status         task_status not null default 'todo',
  assignee_id    uuid        references profiles (id) on delete set null,
  due_date       date,
  estimate_hours numeric(8, 2) check (estimate_hours > 0),
  sort_order     integer     not null default 0,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index tasks_project_idx  on tasks (project_id, status, sort_order);
create index tasks_assignee_idx on tasks (assignee_id, status);

-- ---------------------------------------------------------------------------
-- time_entries
-- A time entry must always belong to a project. A task is optional.
-- ---------------------------------------------------------------------------

create table time_entries (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references profiles (id) on delete restrict,
  project_id       uuid        not null references projects (id) on delete restrict,
  task_id          uuid        references tasks (id) on delete set null,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_seconds integer     check (duration_seconds >= 0),
  description      text,
  billable         boolean     not null default true,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  deleted_by       uuid        references profiles (id) on delete set null,
  constraint time_entry_ends_after_start check (ended_at is null or ended_at > started_at),
  constraint time_entry_duration_presence check (
    (ended_at is null and duration_seconds is null)
    or (ended_at is not null and duration_seconds is not null)
  )
);

create index time_entries_user_idx    on time_entries (user_id, started_at desc) where deleted_at is null;
create index time_entries_project_idx on time_entries (project_id, started_at)   where deleted_at is null;
create index time_entries_task_idx    on time_entries (task_id)                  where deleted_at is null;

-- One running timer per user. Starting a new one must stop the old one first.
create unique index one_running_timer_per_user
  on time_entries (user_id)
  where ended_at is null and deleted_at is null;

comment on constraint time_entry_duration_presence on time_entries is
  'A running entry has neither end nor duration; a finished entry has both. Kept in step by the sync trigger.';
