-- Flourish Ops — usage aggregates
--
-- These functions only ever sum seconds. Every calculation that turns seconds
-- into a balance, a percentage or a rate lives in src/lib/calc.ts, so there is
-- exactly one place where the arithmetic can be wrong and exactly one place
-- to test it.
--
-- SECURITY INVOKER (the default) so row level security still applies: a member
-- calling these sees only their own time.

create or replace function public.brisbane_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Australia/Brisbane')::date $$;

create or replace function public.project_usage(p_as_of date default null)
returns table (
  project_id             uuid,
  total_seconds          bigint,
  current_period_seconds bigint,
  current_period_id      uuid
)
language sql
stable
as $$
  with as_of as (
    select coalesce(p_as_of, public.brisbane_today()) as day
  ),
  current_periods as (
    select rp.project_id, rp.id, rp.period_start, rp.period_end
    from public.retainer_periods rp, as_of
    where as_of.day between rp.period_start and rp.period_end
  )
  select
    p.id,
    coalesce((
      select sum(te.duration_seconds)
      from public.time_entries te
      where te.project_id = p.id and te.deleted_at is null
    ), 0)::bigint,
    coalesce((
      select sum(te.duration_seconds)
      from public.time_entries te
      where te.project_id = p.id
        and te.deleted_at is null
        and cp.id is not null
        and te.started_at >= (cp.period_start::timestamp at time zone 'Australia/Brisbane')
        and te.started_at <  ((cp.period_end + 1)::timestamp at time zone 'Australia/Brisbane')
    ), 0)::bigint,
    cp.id
  from public.projects p
  left join current_periods cp on cp.project_id = p.id;
$$;

comment on function public.project_usage(date) is
  'Seconds logged per project: all time, and within the retainer period covering the given day.';

-- Seconds logged per project between two Brisbane dates, both inclusive.
-- Used by reporting and the billing export.
create or replace function public.project_usage_between(p_from date, p_to date)
returns table (
  project_id    uuid,
  user_id       uuid,
  billable      boolean,
  used_seconds  bigint
)
language sql
stable
as $$
  select te.project_id, te.user_id, te.billable, sum(te.duration_seconds)::bigint
  from public.time_entries te
  where te.deleted_at is null
    and te.duration_seconds is not null
    and te.started_at >= (p_from::timestamp at time zone 'Australia/Brisbane')
    and te.started_at <  ((p_to + 1)::timestamp at time zone 'Australia/Brisbane')
  group by te.project_id, te.user_id, te.billable;
$$;

revoke all on function public.project_usage(date)              from anon;
revoke all on function public.project_usage_between(date, date) from anon;
grant execute on function public.project_usage(date)               to authenticated;
grant execute on function public.project_usage_between(date, date) to authenticated;
