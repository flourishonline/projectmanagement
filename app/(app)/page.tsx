import Link from 'next/link'
import { requireProfile } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ensureRetainerPeriods } from '@/lib/server/periods'
import { loadDashboard } from '@/lib/server/dashboard'
import { formatDurationHours } from '@/lib/calc'
import {
  endOfWeek,
  brisbaneStartOfDay,
  brisbaneEndOfDay,
  formatDisplayDate,
  startOfWeek,
  toBrisbaneDate,
} from '@/lib/dates'
import { ProjectCard } from '@/components/project-card'
import { Card, EmptyState, SectionHeading } from '@/components/ui'
import type { Client, Project, TimeEntry } from '@/lib/db-types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const profile = await requireProfile()
  return profile.role === 'admin' ? <AdminDashboard /> : <MemberDashboard userId={profile.id} />
}

async function AdminDashboard() {
  const today = toBrisbaneDate(new Date())

  // Generating periods on read keeps the dashboard honest even if a scheduled
  // run was missed. It is idempotent, so this costs nothing on a normal day.
  await ensureRetainerPeriods(createSupabaseAdminClient(), today)

  const supabase = await createSupabaseServerClient()
  const { groups, cards } = await loadDashboard(supabase, today)

  const inTrouble = cards.filter(
    (card) => card.burn.state === 'overdrawn' || card.burn.state === 'critical',
  ).length

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">Dashboard</h1>
          <p className="text-sm text-ink-500">
            {formatDisplayDate(today)} ·{' '}
            {cards.length === 0
              ? 'No active projects yet'
              : inTrouble === 0
                ? `${cards.length} active projects, all within budget`
                : `${inTrouble} of ${cards.length} projects need attention`}
          </p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink-50"
        >
          New project
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          body="Add a client and a project, and the burn figures will appear here."
        />
      ) : (
        groups.map((group) => (
          <section key={group.folder?.id ?? 'ungrouped'} className="space-y-3">
            <SectionHeading>{group.folder?.name ?? 'Ungrouped'}</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.cards.map((card) => (
                <ProjectCard key={card.project.id} card={card} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

/**
 * The member view deliberately carries no budget, rate or revenue figures.
 * It could not show them anyway — row level security hides the tables that
 * hold them — but the shape of the page reflects that too.
 */
async function MemberDashboard({ userId }: { userId: string }) {
  const supabase = await createSupabaseServerClient()
  const today = toBrisbaneDate(new Date())
  const weekStart = startOfWeek(today)
  const weekEnd = endOfWeek(today)

  const [projectsResult, clientsResult, entriesResult] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, client_id, type, status')
      .in('status', ['active', 'paused'])
      .order('name')
      .returns<Array<Pick<Project, 'id' | 'name' | 'client_id' | 'type' | 'status'>>>(),
    supabase.from('clients').select('id, name').returns<Array<Pick<Client, 'id' | 'name'>>>(),
    supabase
      .from('time_entries')
      .select('id, project_id, duration_seconds, started_at, billable')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('started_at', brisbaneStartOfDay(weekStart).toISOString())
      .lt('started_at', brisbaneEndOfDay(weekEnd).toISOString())
      .returns<Array<Pick<TimeEntry, 'id' | 'project_id' | 'duration_seconds' | 'started_at' | 'billable'>>>(),
  ])

  const entries = entriesResult.data ?? []
  const totalSeconds = entries.reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0)
  const billableSeconds = entries
    .filter((entry) => entry.billable)
    .reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0)

  const clientNames = new Map((clientsResult.data ?? []).map((client) => [client.id, client.name]))
  const projects = projectsResult.data ?? []

  const byProject = new Map<string, number>()
  for (const entry of entries) {
    byProject.set(entry.project_id, (byProject.get(entry.project_id) ?? 0) + (entry.duration_seconds ?? 0))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">Your week</h1>
        <p className="text-sm text-ink-500">
          {formatDisplayDate(weekStart)} – {formatDisplayDate(weekEnd)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Logged this week" value={`${formatDurationHours(totalSeconds)} hrs`} />
        <Stat label="Billable" value={`${formatDurationHours(billableSeconds)} hrs`} />
        <Stat
          label="Non-billable"
          value={`${formatDurationHours(totalSeconds - billableSeconds)} hrs`}
        />
      </div>

      <section className="space-y-3">
        <SectionHeading>Your projects</SectionHeading>
        {projects.length === 0 ? (
          <EmptyState
            title="No projects assigned yet"
            body="An admin needs to add you to a project before you can log time against it."
          />
        ) : (
          <Card>
            <ul className="divide-y divide-ink-200">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 truncate">
                    <span className="text-ink-500">{clientNames.get(project.client_id) ?? '—'}</span>
                    <span className="mx-1.5 text-ink-300">·</span>
                    <span className="font-medium text-ink-900">{project.name}</span>
                  </Link>
                  <span className="nums shrink-0 text-ink-700">
                    {formatDurationHours(byProject.get(project.id) ?? 0)} hrs this week
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="nums mt-0.5 text-xl font-semibold text-ink-900">{value}</p>
    </Card>
  )
}
