import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  calculateRollover,
  generateRetainerPeriods,
  type RetainerPeriodBounds,
} from '@/lib/calc'
import { brisbaneEndOfDay, brisbaneStartOfDay, compareIsoDates, toBrisbaneDate, type IsoDate } from '@/lib/dates'
import type { RetainerConfig, RetainerPeriod } from '@/lib/db-types'

/**
 * Brings every retainer's periods up to date.
 *
 * Periods are generated on demand rather than by a database job, so the
 * dashboard is always looking at a complete picture even if a scheduled run
 * was missed. It is idempotent: running it twice on the same day changes
 * nothing.
 *
 * Closing a period is where rollover happens. Because rollover chains — this
 * period's carry-over becomes the next period's opening balance — periods are
 * always processed oldest first.
 *
 * Runs with the service-role client: it writes on behalf of the system, not of
 * whoever happened to load the page.
 */
export interface EnsurePeriodsResult {
  created: number
  closed: number
  projectsTouched: number
}

interface ProjectEntry {
  project_id: string
  started_at: string
  duration_seconds: number | null
}

export async function ensureRetainerPeriods(
  admin: SupabaseClient,
  today: IsoDate = toBrisbaneDate(new Date()),
): Promise<EnsurePeriodsResult> {
  const result: EnsurePeriodsResult = { created: 0, closed: 0, projectsTouched: 0 }

  const { data: configs, error: configError } = await admin
    .from('retainer_configs')
    .select('*, projects!inner(id, status)')
    .in('projects.status', ['active', 'paused'])
    .returns<Array<RetainerConfig & { projects: { id: string; status: string } }>>()

  if (configError) throw configError
  if (!configs || configs.length === 0) return result

  const projectIds = configs.map((config) => config.project_id)

  const [{ data: existingPeriods, error: periodError }, { data: entries, error: entryError }] =
    await Promise.all([
      admin
        .from('retainer_periods')
        .select('*')
        .in('project_id', projectIds)
        .returns<RetainerPeriod[]>(),
      admin
        .from('time_entries')
        .select('project_id, started_at, duration_seconds')
        .in('project_id', projectIds)
        .is('deleted_at', null)
        .not('duration_seconds', 'is', null)
        .returns<ProjectEntry[]>(),
    ])

  if (periodError) throw periodError
  if (entryError) throw entryError

  const periodsByProject = groupBy(existingPeriods ?? [], (period) => period.project_id)
  const entriesByProject = groupBy(entries ?? [], (entry) => entry.project_id)

  for (const config of configs) {
    const bounds = generateRetainerPeriods({
      startDate: config.start_date,
      billingDayOfMonth: config.billing_day_of_month,
      upTo: today,
      endDate: config.end_date,
    })
    if (bounds.length === 0) continue

    const existing = new Map(
      (periodsByProject.get(config.project_id) ?? []).map((period) => [period.period_start, period]),
    )
    const projectEntries = entriesByProject.get(config.project_id) ?? []

    let carryIn = 0
    let touched = false

    for (const bound of bounds) {
      const row = existing.get(bound.periodStart)
      const isPast = compareIsoDates(bound.periodEnd, today) < 0

      let periodId = row?.id
      let allocated = row?.allocated_hours ?? config.monthly_hours
      let rolledIn = row?.rolled_in_hours ?? 0

      if (!row) {
        const { data: inserted, error } = await admin
          .from('retainer_periods')
          .insert({
            project_id: config.project_id,
            period_start: bound.periodStart,
            period_end: bound.periodEnd,
            allocated_hours: config.monthly_hours,
            rolled_in_hours: carryIn,
          })
          .select('id')
          .single<{ id: string }>()

        if (error) throw error
        periodId = inserted.id
        allocated = config.monthly_hours
        rolledIn = carryIn
        result.created += 1
        touched = true
      } else if (!row.closed && row.rolled_in_hours !== carryIn) {
        // A closed period is history and is never rewritten. An open one is
        // corrected if an edit to earlier time changed what carried in.
        const { error } = await admin
          .from('retainer_periods')
          .update({ rolled_in_hours: carryIn, period_end: bound.periodEnd })
          .eq('id', row.id)
        if (error) throw error
        rolledIn = carryIn
        touched = true
      }

      const usedSeconds = sumWithin(projectEntries, bound)

      if (isPast) {
        if (!row?.closed && periodId) {
          const { error } = await admin
            .from('retainer_periods')
            .update({ closed: true, closed_at: new Date().toISOString() })
            .eq('id', periodId)
          if (error) throw error
          result.closed += 1
          touched = true
        }

        carryIn = calculateRollover({
          allocatedHours: allocated,
          rolledInHours: rolledIn,
          usedSeconds,
          rolloverEnabled: config.rollover_enabled,
          rolloverCapHours: config.rollover_cap_hours,
        })
      } else {
        carryIn = 0
      }
    }

    if (touched) result.projectsTouched += 1
  }

  return result
}

function sumWithin(entries: readonly ProjectEntry[], bound: RetainerPeriodBounds): number {
  const from = brisbaneStartOfDay(bound.periodStart).getTime()
  const to = brisbaneEndOfDay(bound.periodEnd).getTime()

  return entries.reduce((total, entry) => {
    const at = new Date(entry.started_at).getTime()
    if (at < from || at >= to) return total
    return total + (entry.duration_seconds ?? 0)
  }, 0)
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = map.get(k)
    if (bucket) bucket.push(item)
    else map.set(k, [item])
  }
  return map
}
