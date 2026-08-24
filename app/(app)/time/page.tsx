import Link from 'next/link'
import { requireProfile, displayName } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDurationHours } from '@/lib/calc'
import {
  addDays,
  brisbaneEndOfDay,
  brisbaneStartOfDay,
  endOfWeek,
  formatDisplayDate,
  startOfWeek,
  toBrisbaneDate,
} from '@/lib/dates'
import { Card, EmptyState, SectionHeading } from '@/components/ui'
import { EntryTable, type ProjectOption } from './entry-table'
import { ManualEntryForm } from './manual-entry-form'
import type { Client, Profile, Project, TimeEntry } from '@/lib/db-types'

export const dynamic = 'force-dynamic'

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; user?: string }>
}) {
  const profile = await requireProfile()
  const params = await searchParams
  const supabase = await createSupabaseServerClient()

  const today = toBrisbaneDate(new Date())
  const weekStart = params.week ? startOfWeek(params.week) : startOfWeek(today)
  const weekEnd = endOfWeek(weekStart)

  const isAdmin = profile.role === 'admin'
  const viewingUserId = isAdmin && params.user ? params.user : profile.id

  const [entriesResult, projectsResult, clientsResult, peopleResult] = await Promise.all([
    supabase
      .from('time_entries')
      .select('*, profiles(full_name, email), projects(name, client_id)')
      .eq('user_id', viewingUserId)
      .is('deleted_at', null)
      .gte('started_at', brisbaneStartOfDay(weekStart).toISOString())
      .lt('started_at', brisbaneEndOfDay(weekEnd).toISOString())
      .order('started_at', { ascending: false })
      .returns<
        Array<
          TimeEntry & {
            profiles: { full_name: string | null; email: string } | null
            projects: { name: string; client_id: string } | null
          }
        >
      >(),
    supabase
      .from('projects')
      .select('id, name, client_id')
      .in('status', ['active', 'paused'])
      .order('name')
      .returns<Array<Pick<Project, 'id' | 'name' | 'client_id'>>>(),
    supabase.from('clients').select('id, name').returns<Array<Pick<Client, 'id' | 'name'>>>(),
    isAdmin
      ? supabase.from('profiles').select('*').eq('active', true).order('email').returns<Profile[]>()
      : Promise.resolve({ data: [] as Profile[] }),
  ])

  const clientNames = new Map((clientsResult.data ?? []).map((client) => [client.id, client.name]))
  const projectOptions: ProjectOption[] = (projectsResult.data ?? []).map((project) => ({
    id: project.id,
    label: `${clientNames.get(project.client_id) ?? 'Unknown'} — ${project.name}`,
  }))

  const entries = (entriesResult.data ?? []).map((entry) => ({
    ...entry,
    personName: entry.profiles
      ? displayName({ full_name: entry.profiles.full_name, email: entry.profiles.email })
      : '—',
    projectName: entry.projects?.name ?? 'Unknown project',
    clientName: entry.projects ? clientNames.get(entry.projects.client_id) ?? '' : '',
  }))

  const totalSeconds = entries.reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0)
  const billableSeconds = entries
    .filter((entry) => entry.billable)
    .reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0)

  // A per-day total is the number people actually check against their own memory.
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const perDay = new Map<string, number>()
  for (const entry of entries) {
    const day = toBrisbaneDate(new Date(entry.started_at))
    perDay.set(day, (perDay.get(day) ?? 0) + (entry.duration_seconds ?? 0))
  }

  const viewingSelf = viewingUserId === profile.id
  const viewedPerson = (peopleResult.data ?? []).find((person) => person.id === viewingUserId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">
            {viewingSelf ? 'Your time' : `${viewedPerson ? displayName(viewedPerson) : 'Time'}`}
          </h1>
          <p className="text-sm text-ink-500">
            {formatDisplayDate(weekStart)} – {formatDisplayDate(weekEnd)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <WeekLink week={addDays(weekStart, -7)} user={params.user} label="← Previous" />
          <WeekLink week={startOfWeek(today)} user={params.user} label="This week" />
          <WeekLink week={addDays(weekStart, 7)} user={params.user} label="Next →" />
        </div>
      </div>

      {isAdmin ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={weekStart} />
          <label>
            <span className="block text-xs font-medium text-ink-700">Viewing</span>
            <select
              name="user"
              defaultValue={viewingUserId}
              className="mt-1 rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm"
            >
              {(peopleResult.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {displayName(person)}
                  {person.id === profile.id ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink-50"
          >
            Show
          </button>
        </form>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-7">
        {days.map((day) => (
          <Card key={day} className={day === today ? 'border-accent/40 px-3 py-2' : 'px-3 py-2'}>
            <p className="text-[11px] uppercase tracking-wide text-ink-500">
              {formatDisplayDate(day).slice(0, 6)}
            </p>
            <p className="nums mt-0.5 text-base font-semibold text-ink-900">
              {formatDurationHours(perDay.get(day) ?? 0)}
            </p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="nums">
          <span className="text-ink-500">Week total </span>
          <span className="font-semibold text-ink-900">{formatDurationHours(totalSeconds)} hrs</span>
        </span>
        <span className="nums text-ink-500">
          {formatDurationHours(billableSeconds)} billable ·{' '}
          {formatDurationHours(totalSeconds - billableSeconds)} non-billable
        </span>
      </div>

      {viewingSelf || isAdmin ? (
        <ManualEntryForm
          projects={projectOptions}
          today={today}
          people={
            isAdmin
              ? (peopleResult.data ?? [])
                  .filter((person) => person.id !== profile.id)
                  .map((person) => ({ id: person.id, name: displayName(person) }))
              : undefined
          }
        />
      ) : null}

      <section className="space-y-2">
        <SectionHeading>Entries</SectionHeading>
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing logged this week"
            body="Start the timer above, or add an entry manually."
          />
        ) : (
          <EntryTable
            entries={entries}
            projects={projectOptions}
            currentUserId={profile.id}
            showPerson={!viewingSelf}
            canEdit={isAdmin ? true : undefined}
          />
        )}
      </section>
    </div>
  )
}

function WeekLink({ week, user, label }: { week: string; user?: string; label: string }) {
  const query = new URLSearchParams({ week })
  if (user) query.set('user', user)
  return (
    <Link
      href={`/time?${query.toString()}`}
      className="rounded-md border border-ink-300 bg-white px-2.5 py-1.5 font-medium hover:bg-ink-50"
    >
      {label}
    </Link>
  )
}
