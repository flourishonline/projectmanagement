-- Flourish Ops — schema, trigger and RLS assertions.
-- Run through supabase/tests/run.sh against a scratch database.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages to notice;

create schema if not exists test;

create or replace function test.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice '  PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end;
$$;

create or replace function test.raises(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  PASS  % (rejected: %)', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL  % — statement was allowed but should not have been', p_label;
end;
$$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

\echo ''
\echo '== auth provisioning =='

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ellissa@flourishonline.com.au', '{"full_name":"Ellissa"}'),
  ('22222222-2222-2222-2222-222222222222', 'sam@flourishonline.com.au',     '{"full_name":"Sam"}'),
  ('33333333-3333-3333-3333-333333333333', 'jo@flourishonline.com.au',      '{"full_name":"Jo"}');

select test.ok(
  (select role from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'admin',
  'first account to sign in becomes admin');

select test.ok(
  (select count(*) from public.profiles where role = 'member') = 2,
  'every later account defaults to member');

select test.raises(
  $$insert into auth.users (id, email) values (gen_random_uuid(), 'outsider@gmail.com')$$,
  'an address outside the domain cannot be provisioned');

select test.raises(
  $$insert into auth.users (id, email) values (gen_random_uuid(), 'sneaky@notflourishonline.com.au')$$,
  'a domain that merely ends with the allowed one is still rejected');

\echo ''
\echo '== admin can build the commercial structure =='

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

insert into public.clients (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Northwind Foods');

insert into public.projects (id, client_id, name, type, folder_id)
select 'bbbbbbbb-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-000000000001',
       'Northwind — monthly retainer', 'retainer', id
from public.folders where name = 'Retainer Projects';

insert into public.project_rates (project_id, default_hourly_rate)
values ('bbbbbbbb-0000-0000-0000-000000000001', 185.00);

insert into public.retainer_configs
  (project_id, monthly_hours, billing_day_of_month, rollover_enabled, rollover_cap_hours, start_date)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 20, 1, true, 10, date '2026-06-01');

insert into public.retainer_periods
  (project_id, period_start, period_end, allocated_hours, rolled_in_hours)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-01', date '2026-08-31', 20, 4);

select test.ok(
  (select count(*) from public.projects) = 1,
  'admin sees every project');

\echo ''
\echo '== a member sees nothing until assigned =='

set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';

select test.ok((select count(*) from public.projects) = 0, 'unassigned member sees no projects');
select test.ok((select count(*) from public.clients)  = 0, 'unassigned member sees no clients');

select test.raises(
  $$insert into public.clients (name) values ('Member-made client')$$,
  'a member cannot create a client');

-- An UPDATE filtered out by RLS reports success with zero rows touched; the
-- proof it was blocked is that nothing changed.
update public.projects set name = 'renamed'
where id = 'bbbbbbbb-0000-0000-0000-000000000001';

set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select test.ok(
  (select name from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001')
    = 'Northwind — monthly retainer',
  'a member''s update to an invisible project changes nothing');
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';

set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into public.project_members (project_id, user_id)
values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select test.ok((select count(*) from public.projects) = 1, 'assigned member sees the project');
select test.ok((select count(*) from public.clients)  = 1, 'assigned member sees its client');

\echo ''
\echo '== rate and budget data is invisible to members =='

select test.ok((select count(*) from public.project_rates)      = 0, 'member cannot read hourly rates');
select test.ok((select count(*) from public.retainer_configs)   = 0, 'member cannot read retainer configuration');
select test.ok((select count(*) from public.retainer_periods)   = 0, 'member cannot read period allocations');
select test.ok((select count(*) from public.bundle_configs)     = 0, 'member cannot read bundle purchases');
select test.ok((select count(*) from public.standalone_configs) = 0, 'member cannot read fixed fees');

select test.raises(
  $$insert into public.project_rates (project_id, default_hourly_rate)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 1)$$,
  'a member cannot write a rate either');

\echo ''
\echo '== privilege escalation =='

select test.raises(
  $$update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222'$$,
  'a member cannot promote themselves');

set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select test.raises(
  $$update public.profiles set role = 'member' where id = '11111111-1111-1111-1111-111111111111'$$,
  'the only admin cannot demote themselves');

select test.raises(
  $$update public.profiles set active = false where id = '11111111-1111-1111-1111-111111111111'$$,
  'the only admin cannot deactivate themselves');

\echo ''
\echo '== time entries =='

set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';

insert into public.time_entries (id, user_id, project_id, started_at, ended_at, description)
values ('cccccccc-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        'bbbbbbbb-0000-0000-0000-000000000001',
        timestamptz '2026-08-18 09:00+10', timestamptz '2026-08-18 12:15+10', 'Content updates');

select test.ok(
  (select duration_seconds from public.time_entries
    where id = 'cccccccc-0000-0000-0000-000000000001') = 11700,
  'duration is derived from the timestamps, not trusted from the client');

select test.raises(
  $$insert into public.time_entries (user_id, project_id, started_at)
    values ('22222222-2222-2222-2222-222222222222', null, now())$$,
  'time cannot be logged against no project');

select test.raises(
  $$insert into public.time_entries (user_id, project_id, started_at)
    values ('33333333-3333-3333-3333-333333333333',
            'bbbbbbbb-0000-0000-0000-000000000001', now())$$,
  'a member cannot log time as somebody else');

-- One running timer per user.
insert into public.time_entries (user_id, project_id, started_at)
values ('22222222-2222-2222-2222-222222222222',
        'bbbbbbbb-0000-0000-0000-000000000001', now() - interval '10 minutes');

select test.raises(
  $$insert into public.time_entries (user_id, project_id, started_at)
    values ('22222222-2222-2222-2222-222222222222',
            'bbbbbbbb-0000-0000-0000-000000000001', now())$$,
  'a second running timer for the same user is refused');

select test.ok(
  (select duration_seconds is null and ended_at is null
     from public.time_entries
    where user_id = '22222222-2222-2222-2222-222222222222' and ended_at is null) ,
  'a running entry carries neither end time nor duration');

-- Likewise a DELETE: RLS filters the row out rather than raising, so the
-- assertion is that the row survives.
delete from public.time_entries where id = 'cccccccc-0000-0000-0000-000000000001';
select test.ok(
  (select count(*) from public.time_entries
    where id = 'cccccccc-0000-0000-0000-000000000001') = 1,
  'a member cannot hard-delete an entry');

update public.time_entries set deleted_at = now()
where id = 'cccccccc-0000-0000-0000-000000000001';
select test.ok(
  (select deleted_at is not null from public.time_entries
    where id = 'cccccccc-0000-0000-0000-000000000001'),
  'a member removes an entry by soft-deleting it');

update public.time_entries set description = 'resurrected'
where id = 'cccccccc-0000-0000-0000-000000000001';
select test.ok(
  (select description from public.time_entries
    where id = 'cccccccc-0000-0000-0000-000000000001') = 'Content updates',
  'a member''s edit to a soft-deleted entry is ignored');

\echo ''
\echo '== one member cannot see another member''s time =='

set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333"}';
select test.ok((select count(*) from public.time_entries) = 0, 'members see only their own entries');

set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select test.ok((select count(*) from public.time_entries) = 2, 'admin sees every entry, deleted included');

update public.time_entries set description = 'Content updates (corrected)'
where id = 'cccccccc-0000-0000-0000-000000000001';
select test.ok(
  (select edited_at is not null from public.time_entries
    where id = 'cccccccc-0000-0000-0000-000000000001'),
  'an admin edit to someone else''s entry is stamped');

\echo ''
\echo '== task integrity =='

insert into public.tasks (id, project_id, title)
values ('dddddddd-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001', 'Draft August newsletter');

insert into public.projects (id, client_id, name, type)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Northwind — site refresh', 'standalone');

select test.raises(
  $$insert into public.time_entries (user_id, project_id, task_id, started_at, ended_at)
    values ('11111111-1111-1111-1111-111111111111',
            'bbbbbbbb-0000-0000-0000-000000000002',
            'dddddddd-0000-0000-0000-000000000001',
            now() - interval '1 hour', now())$$,
  'a task from another project cannot be attached to an entry');

update public.tasks set status = 'done' where id = 'dddddddd-0000-0000-0000-000000000001';
select test.ok(
  (select completed_at is not null from public.tasks
    where id = 'dddddddd-0000-0000-0000-000000000001'),
  'completing a task stamps completed_at');

update public.tasks set status = 'in_progress' where id = 'dddddddd-0000-0000-0000-000000000001';
select test.ok(
  (select completed_at is null from public.tasks
    where id = 'dddddddd-0000-0000-0000-000000000001'),
  'reopening a task clears completed_at');

update public.projects set status = 'archived' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select test.ok(
  (select archived_at is not null from public.projects
    where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'archiving a project stamps archived_at');

\echo ''
\echo '== deactivated accounts lose access =='

reset role;
insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'second.admin@flourishonline.com.au');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
update public.profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444';
select test.ok(
  (select role from public.profiles where id = '44444444-4444-4444-4444-444444444444') = 'admin',
  'an admin can promote a member');
update public.profiles set active = false where id = '22222222-2222-2222-2222-222222222222';

set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select test.ok((select count(*) from public.folders) = 0, 'a deactivated member reads nothing');

\echo ''
\echo '== usage aggregates respect the Brisbane period window =='

set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- Soft deletion is a review queue, not a shredder: an admin can put an entry back.
update public.time_entries set deleted_at = null, deleted_by = null
where id = 'cccccccc-0000-0000-0000-000000000001';
select test.ok(
  (select deleted_at is null from public.time_entries
    where id = 'cccccccc-0000-0000-0000-000000000001'),
  'an admin can restore a soft-deleted entry');

-- The last half hour of the period, Brisbane time, is inside it.
insert into public.time_entries (user_id, project_id, started_at, ended_at)
values ('11111111-1111-1111-1111-111111111111',
        'bbbbbbbb-0000-0000-0000-000000000001',
        timestamptz '2026-08-31 23:30+10', timestamptz '2026-09-01 00:00+10');

-- Half an hour later is the next period and must not be counted.
insert into public.time_entries (user_id, project_id, started_at, ended_at)
values ('11111111-1111-1111-1111-111111111111',
        'bbbbbbbb-0000-0000-0000-000000000001',
        timestamptz '2026-09-01 00:30+10', timestamptz '2026-09-01 01:30+10');

select test.ok(
  (select current_period_seconds from public.project_usage(date '2026-08-20')
    where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 11700 + 1800,
  'the period window closes at midnight Brisbane, not midnight UTC');

select test.ok(
  (select total_seconds from public.project_usage(date '2026-08-20')
    where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 11700 + 1800 + 3600,
  'all-time totals ignore the period window');

select test.ok(
  (select count(*) from public.project_usage(date '2026-08-20')
    where project_id = 'bbbbbbbb-0000-0000-0000-000000000002'
      and current_period_id is null) = 1,
  'a project with no retainer period reports no current period');

select test.ok(
  (select sum(used_seconds) from public.project_usage_between(date '2026-08-01', date '2026-08-31')) = 11700 + 1800,
  'a date range export counts only entries inside it');

-- A soft-deleted entry is invisible to every aggregate.
update public.time_entries set deleted_at = now()
where started_at = timestamptz '2026-08-31 23:30+10';
select test.ok(
  (select current_period_seconds from public.project_usage(date '2026-08-20')
    where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 11700,
  'soft-deleted time drops out of the totals');

reset role;
\echo ''
\echo 'All assertions passed.'
