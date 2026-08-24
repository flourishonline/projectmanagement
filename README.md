# Flourish Ops

Internal time and project tracking for Flourish Online. Replaces ClickUp and Toggl.

It answers one question reliably: **how many hours are left?** — for retainers, for
bundles, and as variance against quote for fixed-fee work.

Staff only. Clients never log in. It does not produce invoices.

---

## Phase 1 status

Phase 1 of the build brief is complete:

- Google sign-in restricted to `@flourishonline.com.au`, roles, row level security
- Clients, folders, projects with retainer / bundle / standalone configuration
- Live timer and manual entry, both first-class
- The three remaining-hours calculations, with 80 unit tests and 43 database assertions
- Admin dashboard with per-folder project cards, and a member view without any budget figures

Phases 2 (tasks, weekly grid) and 3 (reports, CSV billing export) are not built yet. The
schema for tasks already exists and is enforced, so Phase 2 is UI work rather than migration work.

---

## Running it locally

```bash
npm install
cp .env.example .env.local     # then fill it in — see Supabase setup below
npm run dev
```

```bash
npm run typecheck   # TypeScript, strict
npm test            # calculation and helper unit tests
npm run build       # production build
```

### Database tests

The schema, triggers and RLS policies are exercised against a real Postgres, without Supabase:

```bash
PGHOST=/tmp/pgsock PGPORT=5433 PGUSER=postgres ./supabase/tests/run.sh
```

It drops and rebuilds a scratch database, applies every migration in order, then runs
`supabase/tests/rls_test.sql` — which asserts, among other things, that a member cannot read a
rate, cannot promote themselves, cannot see another person's time, and cannot start two timers.

`supabase/tests/_shim.sql` stands in for the parts of Supabase the migrations lean on
(`auth.users`, `auth.uid()`, the `authenticated` role). It is never applied to a real project.

---

## Supabase setup

### 1. Create the project

Create a Supabase project in the Sydney region. Copy the URL and the anon and service-role keys
into `.env.local`.

### 2. Apply the migrations

In order, through the SQL editor or the Supabase CLI:

```
supabase/migrations/0001_schema.sql      tables, constraints, indexes
supabase/migrations/0002_functions.sql   auth trigger, guards, derived timestamps
supabase/migrations/0003_rls.sql         row level security on every table
supabase/migrations/0004_seed_folders.sql  folder taxonomy, from the ClickUp spaces
supabase/migrations/0005_usage.sql       usage aggregates
```

With the CLI: `supabase db push`.

### 3. Configure Google sign-in

In **Authentication → Providers → Google**, enable the provider and set:

- **Authorized Client IDs / Hosted domain**: `flourishonline.com.au`
- **Redirect URL**: `https://<your-domain>/auth/callback`

In the Google Cloud console, add the same redirect URI to the OAuth client, and add
`https://<project-ref>.supabase.co/auth/v1/callback`.

The domain restriction is enforced in **three** independent places, because the brief is explicit
that the OAuth provider must not be the only thing standing between an outside account and the data:

1. the hosted-domain setting on the Google provider,
2. `public.handle_new_user()`, which refuses to create a profile for any other address, and
3. the server-side check in `src/app/auth/callback/route.ts`, which signs the account out and
   deletes it.

The first person to sign in becomes `admin`. Everyone after that is a `member` until an admin
promotes them on the Admin screen.

---

## Deploying to Vercel

Set the environment variables from `.env.example` in the Vercel project, including
`NEXT_PUBLIC_SITE_URL` (the production URL) and a `CRON_SECRET` of your choosing.

`vercel.json` schedules `/api/cron/periods` daily at 14:05 UTC — just after midnight Brisbane —
to open new retainer periods and close finished ones. The admin dashboard performs the same work
on load, so a missed run self-heals; the cron exists so the figures are right before anyone looks.

---

## Seeding real data

There is no importer, by design. Existing ClickUp and Toggl data is exported to CSV and kept
outside this system as an archive.

To load the real client and project list:

```bash
npm run seed -- data/launch.csv
```

`data/launch.csv` is started for you, with the clients visible in the ClickUp export and the gaps
left blank — monthly hours, start dates, rates and opening balances still need filling in.
`data/launch.example.csv` shows every column with realistic values.

The script is re-runnable — projects are matched on client name plus project name, so a second run
updates rather than duplicates, and nothing is ever deleted. A row missing the numbers that define
its type is skipped with a warning rather than seeded as a confident zero, so you can fill the CSV
in over a few passes.

**Opening balances.** `opening_used_hours` is what a client had already used at launch. It is
written as a visible time entry against a `migration@flourishonline.com.au` account rather than
quietly shaved off the allocation, so the dashboard maths stays honest and the adjustment shows in
the project's own time log. That account holds nothing else and can never sign in — it has no
Google identity behind it.

---

## How it is put together

```
src/lib/calc.ts          every hours and money calculation, and nothing else
src/lib/dates.ts         Brisbane time, ISO calendar arithmetic, display formats
src/lib/timer.ts         pure timer rules shared by server and browser
src/lib/csv.ts           RFC 4180 reader and writer
src/lib/server/          data assembly that touches the database
src/app/actions/         server actions — the only write path from the UI
supabase/migrations/     the schema, in order
supabase/tests/          schema, trigger and RLS assertions
```

`src/lib/calc.ts` is the single tested module the brief asks for. The database only ever sums
seconds; every balance, percentage, rollover and effective rate is computed there, so there is
exactly one place the arithmetic can be wrong and exactly one place to test it.

### Things worth knowing

**Durations are stored in seconds and derived from timestamps.** A trigger recomputes
`duration_seconds` from `started_at` and `ended_at` on every write, so the two can never drift
apart. Manual entry takes a number of hours and turns it into an end time, rather than storing a
duration of its own. Display rounds to two decimal places; stored data never does.

**The running timer lives in the database.** Elapsed time is always derived from `started_at`, so a
refresh, a closed tab or a restarted machine picks the timer back up exactly where it was. A partial
unique index enforces one running timer per person; starting a second one stops and saves the
first rather than discarding it.

**A time entry must have a project.** `NOT NULL`, and the RLS insert policy checks the project is
one the person can actually see. Time logged against nothing is the failure the previous setup kept
producing.

**Deleting time is soft.** Entries are hidden and drop out of every total, but stay for an admin to
review and restore from the Admin screen.

**Rollover chains.** Closing a period computes what carries into the next one, capped if a cap is
set. An overdrawn period carries nothing — the overrun is absorbed, not passed on as a debt. Periods
are always processed oldest first, and a closed period is never rewritten.

**Billing days survive short months.** A retainer billed on the 31st runs 31 Jan → 28 Feb → 31 Mar.
Boundaries are measured from the anchor month rather than by stepping forward from the previous
period, so it does not get stuck on the 28th.

---

## Decisions taken while building

Four places where the implementation departs from the brief, each for a reason:

**1. Hourly rates live in `project_rates`, not on `projects`.**
The brief puts `default_hourly_rate` on `projects` and asks for the rate rule to be enforced at the
RLS layer. Those two cannot both hold: Postgres row-level security cannot hide one column from one
user and show it to another, and every Supabase session shares the same `authenticated` role — so a
rate column on `projects` could only ever be hidden in the UI. Splitting it into its own admin-only
table makes the rule real. The same reasoning already applies to the config tables, which hold the
budget figures and are admin-only.

**2. There is a `project_members` table.**
The roles table says members see "assigned projects only", but the data model has nowhere to record
an assignment. This table is that record, and every member-facing policy hangs off it.

**3. A retainer that starts mid-month gets a short first period.**
Retainers reset on the 1st, so `billing_day_of_month` defaults to 1 and rarely needs touching — the
column stays because an off-cycle client should not need a migration. A retainer that begins on, say,
the 10th runs 10–30 for its first period and then aligns to the 1st forever after. That short first
period still receives the **full** monthly allocation, on the assumption that a client starting
mid-month is buying a month of service rather than two thirds of one. It is a one-line change in
`ensureRetainerPeriods` if you would rather pro-rate.

**4. Retainer periods are generated on read as well as on schedule.**
The brief says periods are generated automatically on the billing day. They are, by the daily cron,
but the admin dashboard also brings them up to date when it loads. It is idempotent, and it means a
missed cron run never shows stale figures.

## Still open

- Monthly hours, start dates, rates and opening balances for the clients in `data/launch.csv`.
  Only DSOA's 25 hours and Elene Pilch's 20-hour bundle were legible from the ClickUp export.
- Two client names were truncated in the export and need checking: `[CM] Catherine Morgan (Th…)`
  and `[HF] Happy Families and Ju…`.
- Whether a short first retainer period should get a full month's hours (decision 3 above).

### Noted for Phase 2

ClickUp uses a **Waiting on client** status heavily, and it is the one that matters commercially —
it is the difference between work that is stalled on Flourish and work that is stalled on the
client. It maps to `blocked` in the four fixed task statuses, which is the right home for it, but
the Tasks UI should label it *Waiting on client* rather than *Blocked* so nobody has to translate.
