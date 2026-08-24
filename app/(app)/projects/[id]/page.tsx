import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireProfile, displayName } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  calculateBundleBurn,
  calculateRetainerBurn,
  calculateStandaloneBurn,
  formatAud,
  daysRemainingInPeriod,
  formatDurationHours,
  formatHours,
} from '@/lib/calc'
import { formatDisplayDate, toBrisbaneDate } from '@/lib/dates'
import { Card, EmptyState, ProgressBar, SectionHeading, StateChip } from '@/components/ui'
import { EntryTable } from '../../time/entry-table'
import { AssignmentList, ConfigForm, EditProjectForm, TopUpForm } from './project-forms'
import type {
  BundleConfig,
  Client,
  Folder,
  Profile,
  Project,
  RetainerConfig,
  RetainerPeriod,
  StandaloneConfig,
  TimeEntry,
} from '@/lib/db-types'
import type { ProjectUsageRow } from '@/lib/server/dashboard'

export const dynamic = 'force-dynamic'

const TYPE_LABEL = { retainer: 'Retainer', bundle: 'Bundle', standalone: 'Fixed fee' } as const

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requireProfile()
  const isAdmin = profile.role === 'admin'
  const supabase = await createSupabaseServerClient()
  const today = toBrisbaneDate(new Date())

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle<Project>()

  if (!project) notFound()

  const [clientResult, foldersResult, entriesResult, peopleResult] = await Promise.all([
    supabase.from('clients').select('*').eq('id', project.client_id).maybeSingle<Client>(),
    supabase.from('folders').select('*').order('sort_order').returns<Folder[]>(),
    supabase
      .from('time_entries')
      .select('*, profiles(full_name, email)')
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .limit(200)
      .returns<Array<TimeEntry & { profiles: { full_name: string | null; email: string } | null }>>(),
    supabase.from('profiles').select('*').eq('active', true).order('email').returns<Profile[]>(),
  ])

  const entries = entriesResult.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-ink-500 hover:text-ink-900">
          ← Projects
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">
            <span className="text-ink-500">{clientResult.data?.name ?? '—'}</span>
            <span className="mx-2 text-ink-300">·</span>
            {project.name}
          </h1>
          <span className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-700">
            {TYPE_LABEL[project.type]}
          </span>
          <span className="text-xs capitalize text-ink-500">{project.status}</span>
        </div>
        {project.notes ? <p className="mt-2 max-w-3xl text-sm text-ink-700">{project.notes}</p> : null}
      </div>

      {isAdmin ? <BurnPanel projectId={id} project={project} today={today} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <SectionHeading>Time log</SectionHeading>
          {entries.length === 0 ? (
            <EmptyState title="No time logged against this project yet" />
          ) : (
            <EntryTable
              entries={entries.map((entry) => ({
                ...entry,
                personName: entry.profiles
                  ? displayName({ full_name: entry.profiles.full_name, email: entry.profiles.email })
                  : '—',
                projectName: project.name,
                clientName: clientResult.data?.name ?? '',
              }))}
              canEdit={isAdmin || undefined}
              currentUserId={profile.id}
              showPerson={isAdmin}
              projects={[]}
            />
          )}
        </section>

        {isAdmin ? (
          <aside className="space-y-4">
            <ConfigPanel projectId={id} project={project} today={today} />
            <EditProjectForm
              project={project}
              clients={clientResult.data ? [clientResult.data] : []}
              folders={foldersResult.data ?? []}
              rate={await loadRate(supabase, id)}
            />
            <AssignmentList
              projectId={id}
              people={await loadAssignments(supabase, id, peopleResult.data ?? [])}
            />
          </aside>
        ) : null}
      </div>
    </div>
  )
}

async function loadRate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from('project_rates')
    .select('default_hourly_rate')
    .eq('project_id', projectId)
    .maybeSingle<{ default_hourly_rate: number }>()
  return data?.default_hourly_rate ?? null
}

async function loadAssignments(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  people: Profile[],
): Promise<Array<{ id: string; name: string; assigned: boolean }>> {
  const { data } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .returns<Array<{ user_id: string }>>()

  const assigned = new Set((data ?? []).map((row) => row.user_id))
  return people.map((person) => ({
    id: person.id,
    name: `${displayName(person)}${person.role === 'admin' ? ' (admin — sees everything)' : ''}`,
    assigned: assigned.has(person.id),
  }))
}

async function BurnPanel({
  projectId,
  project,
  today,
}: {
  projectId: string
  project: Project
  today: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data: usage } = await supabase.rpc('project_usage', { p_as_of: today })
  const rows = (usage ?? []) as ProjectUsageRow[]
  const row = rows.find((entry) => entry.project_id === projectId)
  const totalSeconds = row?.total_seconds ?? 0
  const periodSeconds = row?.current_period_seconds ?? 0

  if (project.type === 'retainer') {
    const [{ data: config }, { data: periods }] = await Promise.all([
      supabase
        .from('retainer_configs')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle<RetainerConfig>(),
      supabase
        .from('retainer_periods')
        .select('*')
        .eq('project_id', projectId)
        .order('period_start', { ascending: false })
        .limit(6)
        .returns<RetainerPeriod[]>(),
    ])

    const current = (periods ?? []).find(
      (period) => period.period_start <= today && period.period_end >= today,
    )

    const burn = calculateRetainerBurn({
      allocatedHours: current?.allocated_hours ?? config?.monthly_hours ?? 0,
      rolledInHours: current?.rolled_in_hours ?? 0,
      usedSeconds: periodSeconds,
    })

    return (
      <Card className="p-4">
        <Headline
          used={burn.usedHours}
          available={burn.availableHours}
          percent={burn.percentUsed}
          state={burn.state}
          caption={
            current
              ? `${formatDisplayDate(current.period_start)} – ${formatDisplayDate(current.period_end)} · ${daysRemainingInPeriod(current.period_end, today)} days left`
              : 'No period covers today'
          }
        />
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Detail label="Monthly allocation" value={`${formatHours(burn.allocatedHours)} hrs`} />
          <Detail label="Rolled in" value={`${formatHours(burn.rolledInHours)} hrs`} />
          <Detail label="Remaining" value={`${formatHours(burn.remainingHours)} hrs`} />
          <Detail
            label="Rollover"
            value={
              config?.rollover_enabled
                ? config.rollover_cap_hours === null
                  ? 'On, uncapped'
                  : `On, capped at ${formatHours(config.rollover_cap_hours)} hrs`
                : 'Off — unused hours are forfeited'
            }
          />
        </dl>

        {(periods ?? []).length > 1 ? (
          <div className="mt-4">
            <SectionHeading>Recent periods</SectionHeading>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1 font-medium">Period</th>
                  <th className="py-1 text-right font-medium">Allocated</th>
                  <th className="py-1 text-right font-medium">Rolled in</th>
                  <th className="py-1 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {(periods ?? []).map((period) => (
                  <tr key={period.id}>
                    <td className="py-1.5 text-ink-700">
                      {formatDisplayDate(period.period_start)} – {formatDisplayDate(period.period_end)}
                    </td>
                    <td className="nums py-1.5 text-right">{formatHours(period.allocated_hours)}</td>
                    <td className="nums py-1.5 text-right">{formatHours(period.rolled_in_hours)}</td>
                    <td className="py-1.5 text-right text-ink-500">
                      {period.closed ? 'Closed' : 'Open'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    )
  }

  if (project.type === 'bundle') {
    const { data: purchases } = await supabase
      .from('bundle_configs')
      .select('*')
      .eq('project_id', projectId)
      .order('purchase_date')
      .returns<BundleConfig[]>()

    const burn = calculateBundleBurn(
      (purchases ?? []).map((purchase) => ({
        purchasedHours: purchase.purchased_hours,
        purchaseDate: purchase.purchase_date,
        lowBalanceThresholdPct: purchase.low_balance_threshold_pct,
      })),
      totalSeconds,
    )

    return (
      <Card className="p-4">
        <Headline
          used={burn.usedHours}
          available={burn.purchasedHours}
          percent={burn.percentUsed}
          state={burn.state}
          caption={
            burn.topUpDue
              ? `Past the ${burn.thresholdPct}% mark — time for a top-up conversation`
              : `Top-up flagged at ${burn.thresholdPct}% used`
          }
        />
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Detail label="Purchased" value={`${formatHours(burn.purchasedHours)} hrs`} />
          <Detail label="Used" value={`${formatHours(burn.usedHours)} hrs`} />
          <Detail label="Remaining" value={`${formatHours(burn.remainingHours)} hrs`} />
        </dl>

        <div className="mt-4">
          <SectionHeading>Purchases</SectionHeading>
          <ul className="mt-2 divide-y divide-ink-200 text-sm">
            {(purchases ?? []).map((purchase) => (
              <li key={purchase.id} className="flex items-baseline gap-3 py-1.5">
                <span className="nums font-medium">{formatHours(purchase.purchased_hours)} hrs</span>
                <span className="text-ink-500">{formatDisplayDate(purchase.purchase_date)}</span>
                {purchase.expiry_date ? (
                  <span className="text-ink-500">expires {formatDisplayDate(purchase.expiry_date)}</span>
                ) : null}
                {purchase.note ? <span className="text-ink-500">{purchase.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <TopUpForm projectId={projectId} today={today} />
        </div>
      </Card>
    )
  }

  const { data: config } = await supabase
    .from('standalone_configs')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle<StandaloneConfig>()

  const burn = calculateStandaloneBurn({
    quotedHours: config?.quoted_hours ?? 0,
    fixedFee: config?.fixed_fee ?? 0,
    usedSeconds: totalSeconds,
  })

  return (
    <Card className="p-4">
      <Headline
        used={burn.actualHours}
        available={burn.quotedHours}
        percent={burn.percentUsed}
        state={burn.state}
        caption={config?.due_date ? `Due ${formatDisplayDate(config.due_date)}` : 'No due date set'}
      />
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Detail label="Quoted" value={`${formatHours(burn.quotedHours)} hrs`} />
        <Detail label="Actual" value={`${formatDurationHours(totalSeconds)} hrs`} />
        <Detail
          label="Variance"
          value={
            burn.varianceHours >= 0
              ? `${formatHours(burn.varianceHours)} hrs under`
              : `${formatHours(Math.abs(burn.varianceHours))} hrs over`
          }
        />
        <Detail
          label="Effective rate"
          value={
            burn.effectiveHourlyRate === null
              ? '—'
              : `${formatAud(burn.effectiveHourlyRate)} / hr on ${formatAud(burn.fixedFee)}`
          }
        />
      </dl>
    </Card>
  )
}

async function ConfigPanel({
  projectId,
  project,
  today,
}: {
  projectId: string
  project: Project
  today: string
}) {
  const supabase = await createSupabaseServerClient()

  if (project.type === 'retainer') {
    const { data } = await supabase
      .from('retainer_configs')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle<RetainerConfig>()

    return (
      <ConfigForm
        projectId={projectId}
        type="retainer"
        today={today}
        defaults={{
          monthly_hours: data?.monthly_hours ?? '',
          billing_day_of_month: data?.billing_day_of_month ?? 1,
          rollover_enabled: data?.rollover_enabled ?? false,
          rollover_cap_hours: data?.rollover_cap_hours ?? '',
          start_date: data?.start_date ?? today,
          end_date: data?.end_date ?? '',
        }}
      />
    )
  }

  if (project.type === 'standalone') {
    const { data } = await supabase
      .from('standalone_configs')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle<StandaloneConfig>()

    return (
      <ConfigForm
        projectId={projectId}
        type="standalone"
        today={today}
        defaults={{
          quoted_hours: data?.quoted_hours ?? '',
          fixed_fee: data?.fixed_fee ?? '',
          start_date: data?.start_date ?? today,
          due_date: data?.due_date ?? '',
        }}
      />
    )
  }

  return null
}

function Headline({
  used,
  available,
  percent,
  state,
  caption,
}: {
  used: number
  available: number
  percent: number
  state: Parameters<typeof StateChip>[0]['state']
  caption: string
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="nums text-3xl font-semibold tracking-tight text-ink-900">
          {formatHours(used)}
        </span>
        <span className="nums text-lg text-ink-500">/ {formatHours(available)} hrs</span>
        <span className="ml-auto">
          <StateChip state={state} />
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar percent={percent} state={state} />
      </div>
      <p className="mt-2 text-xs text-ink-500">{caption}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="nums mt-0.5 font-medium text-ink-900">{value}</dd>
    </div>
  )
}
