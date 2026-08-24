import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  calculateBundleBurn,
  calculateRetainerBurn,
  calculateStandaloneBurn,
  compareByUrgency,
  daysRemainingInPeriod,
  type ProjectBurn,
} from '@/lib/calc'
import { toBrisbaneDate, type IsoDate } from '@/lib/dates'
import type {
  BundleConfig,
  Client,
  Folder,
  Project,
  RetainerConfig,
  RetainerPeriod,
  StandaloneConfig,
} from '@/lib/db-types'

export interface ProjectUsageRow {
  project_id: string
  total_seconds: number
  current_period_seconds: number
  current_period_id: string | null
}

export interface DashboardCard {
  project: Project
  clientName: string
  folderId: string | null
  burn: ProjectBurn
  /** Retainers only: days left in the current period. */
  daysRemaining: number | null
  /** Retainers only: the window the figures describe. */
  periodLabel: string | null
  /** True when a retainer is running but has no period covering today. */
  needsAttention: string | null
}

export interface FolderGroup {
  folder: Folder | null
  cards: DashboardCard[]
}

/**
 * Everything the admin dashboard renders.
 *
 * The database returns raw seconds; every balance, percentage and state below
 * comes from src/lib/calc.ts.
 */
export async function loadDashboard(
  supabase: SupabaseClient,
  today: IsoDate = toBrisbaneDate(new Date()),
): Promise<{ groups: FolderGroup[]; cards: DashboardCard[] }> {
  const [projectsResult, foldersResult, clientsResult, usageResult] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('name')
      .returns<Project[]>(),
    supabase.from('folders').select('*').order('sort_order').returns<Folder[]>(),
    supabase.from('clients').select('*').returns<Client[]>(),
    supabase.rpc('project_usage', { p_as_of: today }),
  ])

  const projects = projectsResult.data ?? []
  if (projects.length === 0) return { groups: [], cards: [] }

  const projectIds = projects.map((project) => project.id)

  const [retainers, periods, bundles, standalones] = await Promise.all([
    supabase.from('retainer_configs').select('*').in('project_id', projectIds).returns<RetainerConfig[]>(),
    supabase
      .from('retainer_periods')
      .select('*')
      .in('project_id', projectIds)
      .lte('period_start', today)
      .gte('period_end', today)
      .returns<RetainerPeriod[]>(),
    supabase.from('bundle_configs').select('*').in('project_id', projectIds).returns<BundleConfig[]>(),
    supabase
      .from('standalone_configs')
      .select('*')
      .in('project_id', projectIds)
      .returns<StandaloneConfig[]>(),
  ])

  const clientsById = new Map((clientsResult.data ?? []).map((client) => [client.id, client]))
  const usageRows = (usageResult.data ?? []) as ProjectUsageRow[]
  const usageById = new Map(usageRows.map((row) => [row.project_id, row]))
  const retainerById = new Map((retainers.data ?? []).map((row) => [row.project_id, row]))
  const periodById = new Map((periods.data ?? []).map((row) => [row.project_id, row]))
  const standaloneById = new Map((standalones.data ?? []).map((row) => [row.project_id, row]))

  const bundlesByProject = new Map<string, BundleConfig[]>()
  for (const bundle of bundles.data ?? []) {
    const bucket = bundlesByProject.get(bundle.project_id)
    if (bucket) bucket.push(bundle)
    else bundlesByProject.set(bundle.project_id, [bundle])
  }

  const cards: DashboardCard[] = []

  for (const project of projects) {
    const usage = usageById.get(project.id)
    const totalSeconds = usage?.total_seconds ?? 0
    const periodSeconds = usage?.current_period_seconds ?? 0
    const clientName = clientsById.get(project.client_id)?.name ?? 'Unknown client'

    let burn: ProjectBurn
    let daysRemaining: number | null = null
    let periodLabel: string | null = null
    let needsAttention: string | null = null

    switch (project.type) {
      case 'retainer': {
        const config = retainerById.get(project.id)
        const period = periodById.get(project.id)

        if (!config) {
          needsAttention = 'No retainer configuration yet'
        } else if (!period) {
          needsAttention = 'No period covers today — check the start and end dates'
        }

        burn = calculateRetainerBurn({
          allocatedHours: period?.allocated_hours ?? config?.monthly_hours ?? 0,
          rolledInHours: period?.rolled_in_hours ?? 0,
          usedSeconds: periodSeconds,
        })

        if (period) {
          daysRemaining = daysRemainingInPeriod(period.period_end, today)
          periodLabel = `${period.period_start} → ${period.period_end}`
        }
        break
      }

      case 'bundle': {
        const purchases = bundlesByProject.get(project.id) ?? []
        if (purchases.length === 0) needsAttention = 'No hours purchased yet'

        burn = calculateBundleBurn(
          purchases.map((purchase) => ({
            purchasedHours: purchase.purchased_hours,
            purchaseDate: purchase.purchase_date,
            lowBalanceThresholdPct: purchase.low_balance_threshold_pct,
          })),
          totalSeconds,
        )
        break
      }

      case 'standalone': {
        const config = standaloneById.get(project.id)
        if (!config) needsAttention = 'No quote recorded yet'

        burn = calculateStandaloneBurn({
          quotedHours: config?.quoted_hours ?? 0,
          fixedFee: config?.fixed_fee ?? 0,
          usedSeconds: totalSeconds,
        })
        break
      }
    }

    cards.push({
      project,
      clientName,
      folderId: project.folder_id,
      burn,
      daysRemaining,
      periodLabel,
      needsAttention,
    })
  }

  // Trouble first, everywhere.
  cards.sort((a, b) => compareByUrgency(a.burn, b.burn))

  const folders = foldersResult.data ?? []
  const groups: FolderGroup[] = folders.map((folder) => ({
    folder,
    cards: cards.filter((card) => card.folderId === folder.id),
  }))

  const ungrouped = cards.filter((card) => card.folderId === null)
  if (ungrouped.length > 0) groups.push({ folder: null, cards: ungrouped })

  return { groups: groups.filter((group) => group.cards.length > 0), cards }
}
